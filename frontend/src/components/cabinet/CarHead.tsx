import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import type { VehicleItem } from "@/lib/api/queries";
import { SHORT } from "@/lib/constants";
import { ownerKindLabel, vehicleTone } from "@/lib/format";
import { NavLink, type Route } from "@/lib/nav";

export function CarHead({ car, backRoute, backLabel }: { car: VehicleItem; backRoute: Route; backLabel: string }) {
  return (
    <>
      <NavLink route={backRoute} className="back">
        <Icon name="back" />
        {backLabel}
      </NavLink>
      <header className="head" style={{ alignItems: "flex-start" }}>
        <div>
          <h1 className="large-title">{car.title}</h1>
          <div className="meta">
            <span className="mono">{car.vin ? "VIN " + car.vin : "VIN не заполнен"}</span>
            <span>
              {`${ownerKindLabel(car.client.type)} · ${car.client.name}`}
            </span>
          </div>
        </div>
        <Badge text={SHORT[car.currentStep - 1]} tone={vehicleTone(car)} />
      </header>
    </>
  );
}
