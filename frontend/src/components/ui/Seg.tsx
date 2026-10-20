type Item<T extends string> = { v: T; l: string; n?: number };

export function Seg<T extends string>({
  name,
  items,
  value,
  onSelect,
}: {
  name: string;
  items: Item<T>[];
  value: T;
  onSelect: (v: T) => void;
}) {
  return (
    <div className="seg" role="group" aria-label={name}>
      {items.map((i) => (
        <button key={i.v} type="button" aria-pressed={i.v === value} onClick={() => onSelect(i.v)}>
          {i.n != null ? i.l + " " : i.l}
          {i.n != null && <span className="n">{i.n}</span>}
        </button>
      ))}
    </div>
  );
}
