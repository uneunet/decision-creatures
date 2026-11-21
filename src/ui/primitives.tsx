import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog';
import { Button as BaseButton } from '@base-ui/react/button';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { Meter as BaseMeter } from '@base-ui/react/meter';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { Progress as BaseProgress } from '@base-ui/react/progress';
import { Slider as BaseSlider } from '@base-ui/react/slider';
import { Toggle as BaseToggle } from '@base-ui/react/toggle';
import { ToggleGroup as BaseToggleGroup } from '@base-ui/react/toggle-group';
import { motion } from 'motion/react';
import type { ComponentProps, ReactNode } from 'react';

function mergeClassName<S>(
  base: string,
  extra?: string | ((state: S) => string | undefined),
): string | ((state: S) => string | undefined) {
  if (!extra) return base;
  if (typeof extra === 'function') {
    return (state: S) => {
      const resolved = extra(state);
      return resolved ? `${base} ${resolved}` : base;
    };
  }
  return `${base} ${extra}`;
}

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/* -------------------------------------------------------------------------- */
/* PopButton                                                                  */
/* -------------------------------------------------------------------------- */

export interface PopButtonProps extends ComponentProps<typeof BaseButton> {
  variant?: 'primary' | 'surface' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'icon';
}

const BUTTON_VARIANTS: Record<NonNullable<PopButtonProps['variant']>, string> = {
  primary:
    'bg-[var(--attr-pop)] text-white border-2 border-[var(--attr-pop-dark)] border-b-[4px] active:translate-y-[2px] active:border-b-2',
  surface:
    'bg-[var(--surface)] text-[var(--fg)] border-2 border-[var(--attr-stroke)] border-b-[4px] border-b-[var(--attr-lip)] hover:bg-[var(--surface-sub)] active:translate-y-[2px] active:border-b-2',
  ghost:
    'bg-[var(--surface-sub)] text-[var(--fg)] border-2 border-transparent hover:bg-[var(--attr-stroke)] active:translate-y-[1px]',
  danger:
    'bg-[#ff5c77] text-white border-2 border-[#df3c58] border-b-[4px] active:translate-y-[2px] active:border-b-2',
};

const BUTTON_SIZES: Record<NonNullable<PopButtonProps['size']>, string> = {
  sm: 'h-9 px-3.5 text-xs rounded-full gap-1.5',
  md: 'h-11 px-5 text-sm rounded-full gap-2',
  icon: 'h-9 w-9 rounded-xl',
};

export function PopButton({
  variant = 'surface',
  size = 'md',
  className,
  ...props
}: PopButtonProps) {
  return (
    <BaseButton
      {...props}
      className={mergeClassName(
        cn(
          'inline-flex cursor-pointer select-none items-center justify-center font-extrabold tracking-tight transition-[transform,background-color,border-color] duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--attr-pop)] disabled:pointer-events-none disabled:opacity-45',
          BUTTON_VARIANTS[variant],
          BUTTON_SIZES[size],
        ),
        className,
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* PopMenu                                                                    */
/* -------------------------------------------------------------------------- */

export const PopMenu = {
  Root: BaseMenu.Root,
  Trigger: BaseMenu.Trigger,
  Portal: BaseMenu.Portal,
  Positioner: BaseMenu.Positioner,
  Popup({ className, ...props }: ComponentProps<typeof BaseMenu.Popup>) {
    return (
      <BaseMenu.Popup
        {...props}
        className={mergeClassName(
          'z-50 min-w-48 origin-[var(--transform-origin)] rounded-2xl border-2 border-[var(--attr-stroke)] border-b-[5px] border-b-[var(--attr-lip)] bg-[var(--surface)] p-1.5 text-[var(--fg)] transition-[opacity,transform] duration-150 ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 focus:outline-none',
          className,
        )}
      />
    );
  },
  Item({ className, ...props }: ComponentProps<typeof BaseMenu.Item>) {
    return (
      <BaseMenu.Item
        {...props}
        className={mergeClassName(
          'flex cursor-pointer select-none items-center justify-between gap-3 rounded-xl px-3 py-2 text-xs font-extrabold text-[var(--fg)] outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-[var(--surface-sub)]',
          className,
        )}
      />
    );
  },
  Separator({ className, ...props }: ComponentProps<typeof BaseMenu.Separator>) {
    return (
      <BaseMenu.Separator
        {...props}
        className={mergeClassName('my-1 h-[2px] rounded-full bg-[var(--surface-sub)]', className)}
      />
    );
  },
};

/* -------------------------------------------------------------------------- */
/* PopPopover                                                                 */
/* -------------------------------------------------------------------------- */

export const PopPopover = {
  Root: BasePopover.Root,
  Trigger: BasePopover.Trigger,
  Portal: BasePopover.Portal,
  Positioner: BasePopover.Positioner,
  Popup({ className, ...props }: ComponentProps<typeof BasePopover.Popup>) {
    return (
      <BasePopover.Popup
        {...props}
        className={mergeClassName(
          'z-50 origin-[var(--transform-origin)] rounded-2xl border-2 border-[var(--attr-stroke)] border-b-[5px] border-b-[var(--attr-lip)] bg-[var(--surface)] p-3 text-[var(--fg)] transition-[opacity,transform] duration-150 ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 focus:outline-none',
          className,
        )}
      />
    );
  },
};

/* -------------------------------------------------------------------------- */
/* PopDialog                                                                  */
/* -------------------------------------------------------------------------- */

export const PopDialog = {
  Root: BaseDialog.Root,
  Trigger: BaseDialog.Trigger,
  Close: BaseDialog.Close,
  Title({ className, ...props }: ComponentProps<typeof BaseDialog.Title>) {
    return (
      <BaseDialog.Title
        {...props}
        className={mergeClassName(
          'inline-flex items-center gap-2 text-base font-black tracking-tight text-[var(--fg)]',
          className,
        )}
      />
    );
  },
  Content({ children, className }: { children: ReactNode; className?: string }) {
    return (
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-40 bg-[var(--backdrop)] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <BaseDialog.Popup
          className={cn(
            'fixed top-1/2 left-1/2 z-50 max-h-[86vh] w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[24px] border-2 border-[var(--attr-stroke)] border-b-[6px] border-b-[var(--attr-lip)] bg-[var(--surface)] p-5 text-[var(--fg)] transition-[opacity,transform] duration-180 ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 focus:outline-none',
            className,
          )}
        >
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    );
  },
};

/* -------------------------------------------------------------------------- */
/* PopAlertDialog                                                             */
/* -------------------------------------------------------------------------- */

export const PopAlertDialog = {
  Root: BaseAlertDialog.Root,
  Trigger: BaseAlertDialog.Trigger,
  Close: BaseAlertDialog.Close,
  Title({ className, ...props }: ComponentProps<typeof BaseAlertDialog.Title>) {
    return (
      <BaseAlertDialog.Title
        {...props}
        className={mergeClassName(
          'inline-flex items-center gap-2 text-base font-black tracking-tight text-[var(--fg)]',
          className,
        )}
      />
    );
  },
  Description({ className, ...props }: ComponentProps<typeof BaseAlertDialog.Description>) {
    return (
      <BaseAlertDialog.Description
        {...props}
        className={mergeClassName(
          'text-xs leading-relaxed font-bold text-[var(--fg-muted)]',
          className,
        )}
      />
    );
  },
  Content({ children, className }: { children: ReactNode; className?: string }) {
    return (
      <BaseAlertDialog.Portal>
        <BaseAlertDialog.Backdrop className="fixed inset-0 z-40 bg-[var(--backdrop)] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <BaseAlertDialog.Popup
          className={cn(
            'fixed top-1/2 left-1/2 z-50 w-[min(92vw,380px)] -translate-x-1/2 -translate-y-1/2 rounded-[24px] border-2 border-[var(--attr-stroke)] border-b-[6px] border-b-[var(--attr-lip)] bg-[var(--surface)] p-5 text-[var(--fg)] transition-[opacity,transform] duration-180 ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 focus:outline-none',
            className,
          )}
        >
          {children}
        </BaseAlertDialog.Popup>
      </BaseAlertDialog.Portal>
    );
  },
};

/* -------------------------------------------------------------------------- */
/* PopProgress                                                                */
/* -------------------------------------------------------------------------- */

export function PopProgress({
  value,
  label,
  detail,
}: {
  value: number | null;
  label: string;
  detail?: string;
}) {
  const clamped = value === null ? null : Math.max(0, Math.min(100, value));
  return (
    <BaseProgress.Root value={clamped} className="w-full">
      <div className="mb-1.5 flex items-baseline justify-between gap-2 font-mono text-[11px] font-bold">
        <BaseProgress.Label className="truncate text-[var(--fg)]">{label}</BaseProgress.Label>
        {detail && <span className="shrink-0 tabular-nums text-[var(--fg-muted)]">{detail}</span>}
      </div>
      <BaseProgress.Track className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--track)]">
        <BaseProgress.Indicator
          className="h-full rounded-full bg-[var(--attr-pop)] transition-[width] duration-200 ease-out"
          style={clamped === null ? { width: '100%' } : undefined}
        />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}

/* -------------------------------------------------------------------------- */
/* PopStatMeter (Completely flat color-coded stat gauge with EN + JA labels)  */
/* -------------------------------------------------------------------------- */

export function PopStatMeter({
  en,
  ja,
  value,
  color,
  animate,
  delay = 0,
}: {
  en: string;
  ja: string;
  value: number;
  color: string;
  animate: boolean;
  delay?: number;
}) {
  const pct = Math.max(0.06, Math.min(1, value / 100));

  return (
    <BaseMeter.Root value={value} min={0} max={100} className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <BaseMeter.Label className="inline-flex items-baseline gap-1.5">
          <span className="font-mono text-[11px] font-black tracking-wide text-[var(--fg)]">
            {en}
          </span>
          <span className="text-[10px] font-bold text-[var(--fg-muted)]">{ja}</span>
        </BaseMeter.Label>
        <BaseMeter.Value className="font-mono text-xs font-black tabular-nums text-[var(--fg)]">
          {() => value}
        </BaseMeter.Value>
      </div>
      <BaseMeter.Track className="h-[9px] w-full overflow-hidden rounded-full bg-[var(--track)]">
        <BaseMeter.Indicator
          render={
            <motion.div
              className="h-full w-full origin-left rounded-full"
              style={{ backgroundColor: color }}
              initial={false}
              animate={{ scaleX: animate ? pct : 0 }}
              transition={
                animate
                  ? { duration: 0.48, delay, ease: [0.34, 1.2, 0.64, 1] }
                  : { duration: 0.14 }
              }
            />
          }
        />
      </BaseMeter.Track>
    </BaseMeter.Root>
  );
}

/* -------------------------------------------------------------------------- */
/* PopToggleGroup                                                             */
/* -------------------------------------------------------------------------- */

export function PopToggleGroup({
  className,
  ...props
}: ComponentProps<typeof BaseToggleGroup>) {
  return (
    <BaseToggleGroup
      {...props}
      className={mergeClassName(
        'inline-flex rounded-full border-2 border-[var(--attr-stroke)] bg-[var(--surface-sub)] p-0.5',
        className,
      )}
    />
  );
}

export function PopToggle({
  className,
  ...props
}: ComponentProps<typeof BaseToggle>) {
  return (
    <BaseToggle
      {...props}
      className={mergeClassName(
        'cursor-pointer rounded-full px-3 py-1 font-mono text-[11px] font-extrabold text-[var(--fg-muted)] transition-colors data-[pressed]:bg-[var(--attr-pop)] data-[pressed]:text-white',
        className,
      )}
    />
  );
}

/** Unstyled Base UI ToggleGroup / Toggle re-exports for custom flat-pop pill bars. */
export const PopFilterGroup = BaseToggleGroup;
export const PopFilterItem = BaseToggle;

/* -------------------------------------------------------------------------- */
/* PopSlider (Flat-Pop Slider backed by @base-ui/react/slider)                */
/* -------------------------------------------------------------------------- */

export function PopSlider({
  value,
  min,
  max,
  step = 0.05,
  onValueChange,
  ariaLabel,
  className,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (value: number) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <BaseSlider.Root
      value={value}
      min={min}
      max={max}
      step={step}
      onValueChange={(next) => {
        if (typeof next === 'number') onValueChange(next);
      }}
      className={cn('flex flex-1 items-center', className)}
    >
      <BaseSlider.Control className="flex w-full cursor-pointer touch-none items-center py-2 select-none">
        <BaseSlider.Track className="relative h-2 w-full rounded-full bg-[var(--track)]">
          <BaseSlider.Indicator className="h-full rounded-full bg-[var(--attr-pop)]" />
          <BaseSlider.Thumb
            aria-label={ariaLabel}
            className="h-5 w-5 rounded-full border-2 border-[var(--attr-pop-dark)] border-b-[3.5px] bg-[var(--surface)] transition-transform duration-100 hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--attr-pop)]"
          />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}
