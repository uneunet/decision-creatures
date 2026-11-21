"""Student model architecture for distilling LiquidAI/d1-2B into a lightweight browser head.

Input:
  image_features: float32 [N, 2048]  (output of official `vision_encoder_q8.onnx`)
Output:
  logits:         float32 [60]       (concatenated logits for all 11 S-rank questions)

Question slice layout (total = 60):
  0: substance   (7)
  1: biome       (6)
  2: archetype   (6)
  3: size_class  (7)
  4: is_living   (2)
  5: size_7      (7)
  6: mass_5      (5)
  7: power       (5)
  8: agility     (5)
  9: mystique    (5)
 10: warmth      (5)

Designed strictly with standard ONNX ops (MatMul, LayerNormalization, Softmax,
ReduceMean, Tanh/Sigmoid, Concat) so WebGPU EP runs cleanly with zero custom ops
on iOS Safari, Chrome, and Edge.
"""

from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F

QUESTION_SPECS: list[tuple[str, str, str, int]] = [
    ("substance", "type", "choice", 7),
    ("biome", "type", "choice", 6),
    ("archetype", "type", "choice", 6),
    ("size_class", "type", "choice", 7),
    ("is_living", "type", "noul", 2),
    ("size_7", "scalar", "score", 7),
    ("mass_5", "scalar", "score", 5),
    ("power", "scalar", "score", 5),
    ("agility", "scalar", "score", 5),
    ("mystique", "scalar", "score", 5),
    ("warmth", "scalar", "score", 5),
]

QUESTION_SIZES: list[int] = [spec[3] for spec in QUESTION_SPECS]
TOTAL_LOGITS: int = sum(QUESTION_SIZES)  # 60
NUM_QUESTIONS: int = len(QUESTION_SPECS)  # 11


class CreatureDistillHead(nn.Module):
    """Per-question Cross-Attention Pooling + MLP distillation head (~1.6M params, ~3 MB FP16)."""

    def __init__(
        self,
        in_dim: int = 2048,
        d_model: int = 256,
        num_heads: int = 4,
        dropout: float = 0.25,
    ) -> None:
        super().__init__()
        assert d_model % num_heads == 0
        self.in_dim = in_dim
        self.d_model = d_model
        self.num_heads = num_heads
        self.head_dim = d_model // num_heads
        self.scale = 1.0 / math.sqrt(self.head_dim)

        # Project [N, 2048] -> [N, d_model]
        self.in_norm = nn.LayerNorm(in_dim)
        self.in_proj = nn.Linear(in_dim, d_model)
        self.in_drop = nn.Dropout(dropout)

        # 11 learnable per-question queries for spatial Cross-Attention Pooling
        self.queries = nn.Parameter(torch.randn(NUM_QUESTIONS, d_model) * 0.02)
        self.q_proj = nn.Linear(d_model, d_model)
        self.k_proj = nn.Linear(d_model, d_model)
        self.v_proj = nn.Linear(d_model, d_model)
        self.attn_out = nn.Linear(d_model, d_model)
        self.attn_drop = nn.Dropout(dropout)
        self.post_attn_norm = nn.LayerNorm(d_model)

        # Shared question refinement FFN (captures cross-question consistency, e.g. size_7 <-> size_class)
        self.self_q = nn.Linear(d_model, d_model)
        self.self_k = nn.Linear(d_model, d_model)
        self.self_v = nn.Linear(d_model, d_model)
        self.self_out = nn.Linear(d_model, d_model)
        self.self_norm = nn.LayerNorm(d_model)

        # Combine per-question attended vector + global mean pooled vector -> [11, 2*d_model]
        self.head_norm = nn.LayerNorm(d_model * 2)
        self.head_fc1 = nn.Linear(d_model * 2, d_model)
        self.head_drop = nn.Dropout(dropout)
        self.head_fc2 = nn.ModuleList([nn.Linear(d_model, k) for k in QUESTION_SIZES])
        # Post-hoc calibration temperature (fitted on internal val set, baked into ONNX export)
        self.register_buffer("temperature", torch.tensor(1.0, dtype=torch.float32))

    def _mha(
        self,
        q_in: torch.Tensor,
        kv_in: torch.Tensor,
        q_proj: nn.Linear,
        k_proj: nn.Linear,
        v_proj: nn.Linear,
        o_proj: nn.Linear,
    ) -> torch.Tensor:
        # q_in: [B, Q, D], kv_in: [B, K, D]
        b, q_len, d = q_in.shape
        k_len = kv_in.shape[1]
        h, hd = self.num_heads, self.head_dim

        q = q_proj(q_in).reshape(b, q_len, h, hd).transpose(1, 2)  # [B, H, Q, HD]
        k = k_proj(kv_in).reshape(b, k_len, h, hd).transpose(1, 2)  # [B, H, K, HD]
        v = v_proj(kv_in).reshape(b, k_len, h, hd).transpose(1, 2)  # [B, H, K, HD]

        scores = torch.matmul(q, k.transpose(-2, -1)) * self.scale
        attn = F.softmax(scores, dim=-1)
        attn = self.attn_drop(attn)
        ctx = torch.matmul(attn, v)  # [B, H, Q, HD]
        ctx = ctx.transpose(1, 2).reshape(b, q_len, d)
        return o_proj(ctx)

    def forward_batched(self, features: torch.Tensor, mask: torch.Tensor | None = None) -> torch.Tensor:
        """Batched forward for training.

        features: [B, N, 2048]
        mask:     [B, N] bool (True = valid patch token, False = pad)
        returns:  [B, 60]
        """
        x = F.silu(self.in_proj(self.in_norm(features)))
        x = self.in_drop(x)  # [B, N, D]

        b, n, d = x.shape
        h, hd = self.num_heads, self.head_dim

        q_base = self.queries.unsqueeze(0).expand(b, -1, -1)  # [B, 11, D]
        q = self.q_proj(q_base).reshape(b, NUM_QUESTIONS, h, hd).transpose(1, 2)
        k = self.k_proj(x).reshape(b, n, h, hd).transpose(1, 2)
        v = self.v_proj(x).reshape(b, n, h, hd).transpose(1, 2)

        scores = torch.matmul(q, k.transpose(-2, -1)) * self.scale
        if mask is not None:
            scores = scores.masked_fill(~mask[:, None, None, :], -1e4)
        attn = self.attn_drop(F.softmax(scores, dim=-1))
        ctx = torch.matmul(attn, v).transpose(1, 2).reshape(b, NUM_QUESTIONS, d)
        q_feat = self.post_attn_norm(q_base + self.attn_out(ctx))

        # Cross-question self-attention so the 11 predictions stay coherent
        q_feat = self.self_norm(
            q_feat + self._mha(q_feat, q_feat, self.self_q, self.self_k, self.self_v, self.self_out)
        )

        # Global mean pooled feature
        if mask is not None:
            m_f = mask.to(x.dtype).unsqueeze(-1)
            g_mean = (x * m_f).sum(dim=1, keepdim=True) / m_f.sum(dim=1, keepdim=True).clamp(min=1.0)
        else:
            g_mean = x.mean(dim=1, keepdim=True)
        g_mean = g_mean.expand(-1, NUM_QUESTIONS, -1)

        combined = self.head_norm(torch.cat([q_feat, g_mean], dim=-1))
        hidden = self.head_drop(F.silu(self.head_fc1(combined)))  # [B, 11, D]

        out_parts = [fc(hidden[:, i, :]) for i, fc in enumerate(self.head_fc2)]
        return torch.cat(out_parts, dim=-1) / self.temperature  # [B, 60]

    def forward(self, image_features: torch.Tensor) -> torch.Tensor:
        """ONNX inference signature: [N, 2048] -> [60]."""
        return self.forward_batched(image_features.unsqueeze(0), mask=None).squeeze(0)


def kl_distillation_loss(logits: torch.Tensor, target_probs: torch.Tensor) -> torch.Tensor:
    """Mean KL(target_probs || student_probs) across all 11 questions."""
    total = logits.new_tensor(0.0)
    offset = 0
    for k in QUESTION_SIZES:
        q_logits = logits[:, offset : offset + k]
        q_target = target_probs[:, offset : offset + k].clamp(min=1e-7)
        q_target = q_target / q_target.sum(dim=-1, keepdim=True)
        log_p = F.log_softmax(q_logits, dim=-1)
        # KL(p || q) = sum p * (log p - log q)
        kl = (q_target * (q_target.log() - log_p)).sum(dim=-1).mean()
        total = total + kl
        offset += k
    return total / NUM_QUESTIONS
