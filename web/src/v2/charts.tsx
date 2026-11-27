/** A small bar chart with its values written out, one bar per period. */
export function BarSeries({
  title,
  bars,
  format,
  floor = 0,
}: {
  title: string;
  bars: { label: string; value: number | null }[];
  format: (value: number) => string;
  /** Lowest value of the scale, for measures that never approach zero. */
  floor?: number;
}) {
  const values = bars.flatMap((bar) => (bar.value === null ? [] : [bar.value]));
  const low = Math.min(floor, ...values);
  const high = Math.max(low + 1, ...values);
  return (
    <figure className="bar-series">
      <figcaption>{title}</figcaption>
      <ol>
        {bars.map((bar, i) => (
          <li key={bar.label} className={i === bars.length - 1 ? "latest" : ""}>
            <span className="bar-value mono">
              {bar.value === null ? "—" : format(bar.value)}
            </span>
            <span className="bar-track" aria-hidden="true">
              <i
                style={{
                  height:
                    bar.value === null
                      ? 0
                      : `${Math.max(2, ((bar.value - low) / (high - low)) * 100)}%`,
                }}
              />
            </span>
            <small>{bar.label}</small>
          </li>
        ))}
      </ol>
    </figure>
  );
}
