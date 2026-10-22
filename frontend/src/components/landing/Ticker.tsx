import { SHORT, TICKER } from "@/lib/constants";

export function Ticker() {
  return (
    <div className="ticker">
      <div className="in">
        <span className="lbl">
          <span>Сейчас в работе</span> (демо)
        </span>
        <div className="win">
          <div className="run">
            {[0, 1, 2, 3].flatMap((k) =>
              TICKER.map(([title, step]) => (
                <span className="it" key={k + title}>
                  <b>{title}</b>
                  <span>
                    {`${SHORT[step - 1]} · этап ${step} из 13`}
                  </span>
                </span>
              )),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
