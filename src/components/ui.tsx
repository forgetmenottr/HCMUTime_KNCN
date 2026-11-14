import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * The small shared pieces of docs/ui-visual-spec.md §0.7. No text of their own:
 * every label is passed in, already translated.
 *
 * States the drawing leaves open (decided here): hover is one step of grey,
 * focus is the global dark outline (index.css), disabled is the pale grey of §0.4.
 */

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
export { cx };

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export function Button({
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex h-10 items-center justify-center gap-1 rounded-md px-4 text-[14px] font-medium whitespace-nowrap",
        variant === "primary"
          ? "bg-accent font-semibold text-brand hover:bg-accent-2 disabled:bg-card disabled:font-medium disabled:text-white"
          : "border border-line bg-white text-ink hover:bg-surface disabled:border-card disabled:text-off",
        className,
      )}
    />
  );
}

/** The bar at the bottom of a step: back on the left, forward on the right. */
export function ActionBar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mt-6 flex items-center justify-between gap-4 border-t border-card pt-4">
      <div className="flex items-center gap-3">{left}</div>
      <div className="flex items-center gap-4">{right}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tooltip: a black box above the control, on hover and on keyboard focus
// ---------------------------------------------------------------------------

export function Tooltip({
  text,
  children,
  className,
  align = "center",
}: {
  text: string | null | undefined | false;
  children: ReactNode;
  className?: string;
  /** Which edge of the control the box lines up with; "end" keeps it inside a card's right edge. */
  align?: "center" | "start" | "end";
}) {
  if (!text) return <>{children}</>;
  return (
    <span className={cx("group/tip relative inline-flex indent-0", className)}>
      {children}
      <span
        role="tooltip"
        className={cx(
          "pointer-events-none invisible absolute bottom-full z-20 mb-2 w-max max-w-[260px] rounded-md bg-ink px-2.5 py-1.5 text-left text-[12px] leading-snug font-normal whitespace-normal text-white opacity-0 transition-opacity",
          // Keyboard focus shows it too; a mouse click does not pin it open (focus-visible, not focus).
          "group-hover/tip:visible group-hover/tip:opacity-100 group-has-focus-visible/tip:visible group-has-focus-visible/tip:opacity-100",
          align === "center" && "left-1/2 -translate-x-1/2",
          align === "start" && "left-0",
          align === "end" && "right-0",
        )}
      >
        {text}
        <span
          aria-hidden
          className={cx(
            "absolute top-full -mt-1 h-2 w-2 rotate-45 bg-ink",
            align === "center" && "left-1/2 -translate-x-1/2",
            align === "start" && "left-4",
            align === "end" && "right-4",
          )}
        />
      </span>
    </span>
  );
}

/** A small "?" that carries an explanation: for labels whose tooltip has no other anchor. */
export function Help({ text, align }: { text: string; align?: "center" | "start" | "end" }) {
  return (
    <Tooltip text={text} align={align}>
      <button
        type="button"
        aria-label={text}
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line text-[10px] leading-none font-semibold text-ink-3 hover:border-brand hover:text-brand"
      >
        ?
      </button>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Segmented control: one choice of a few, cells joined together
// ---------------------------------------------------------------------------

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Shown on hover / focus. */
  tip?: string | null | false;
  /** Cannot be chosen (pale, not clickable). The tooltip still shows. */
  disabled?: boolean;
  /** Paler text, still selectable (a program with no group in the data). */
  dim?: boolean;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  cellClassName = "px-4",
  size = "md",
  disabled = false,
}: {
  options: readonly SegmentOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  /** Width / padding of each cell; fixed widths keep the control still when the language changes. */
  cellClassName?: string;
  size?: "sm" | "md";
  /** The whole control is switched off. */
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-white">
      {options.map((option, i) => {
        const selected = option.value === value;
        const off = disabled || option.disabled === true;
        return (
          <Tooltip key={option.value} text={option.tip}>
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={off || undefined}
              onClick={() => {
                if (!off && !selected) onChange(option.value);
              }}
              className={cx(
                "flex items-center justify-center whitespace-nowrap",
                size === "sm" ? "h-7 text-[12px]" : "h-9 text-[14px]",
                cellClassName,
                i === 0 && "rounded-l-[5px]",
                i === options.length - 1 && "rounded-r-[5px]",
                i > 0 && "border-l border-line",
                selected && !off && "bg-brand font-semibold text-white",
                selected && off && "bg-card font-semibold text-white",
                !selected && off && "cursor-not-allowed bg-[#f2f2f2] text-off",
                !selected && !off && (option.dim ? "text-line hover:bg-surface" : "text-ink-3 hover:bg-surface hover:text-ink"),
              )}
            >
              {option.label}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Round status marks used by several screens
// ---------------------------------------------------------------------------

export function Badge({ children, tone = "outline" }: { children: ReactNode; tone?: "outline" | "accent" | "dashed" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-px text-[11px] font-medium whitespace-nowrap",
        tone === "accent" && "bg-accent font-semibold text-brand",
        tone === "outline" && "border border-line text-ink-2",
        tone === "dashed" && "border border-dashed border-warn text-warn",
      )}
    >
      {children}
    </span>
  );
}

/** "!" or "✓" or "×" in a filled circle. */
export function Glyph({ kind, size = 16 }: { kind: "ok" | "warn" | "fail"; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.65) }}
      className={cx("inline-flex shrink-0 items-center justify-center leading-none font-bold text-white", kind === "ok" ? "rounded-[3px] bg-brand" : "rounded-full bg-warn")}
    >
      {kind === "ok" ? "✓" : kind === "warn" ? "!" : "×"}
    </span>
  );
}
