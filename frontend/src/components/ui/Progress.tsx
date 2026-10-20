/** caption: текст справа под полосой; `false` — подпись не выводить совсем. */
export function Progress({ step, caption }: { step: number; caption?: string | false }) {
  return (
    <div role="progressbar" aria-valuemin={1} aria-valuemax={13} aria-valuenow={step} aria-label={`Этап ${step} из 13`}>
      <div className="progress">
        {Array.from({ length: 13 }, (_, k) => {
          const i = k + 1;
          return <i key={i} className={i < step || step === 13 ? "d" : i === step ? "c" : ""} />;
        })}
      </div>
      {caption !== false && (
        <div className="plabel">
          <span>{`Этап ${step} из 13`}</span>
          <span>{caption || ""}</span>
        </div>
      )}
    </div>
  );
}
