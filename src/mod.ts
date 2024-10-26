import { DependencyContainer } from "tsyringe";
import { IPreSptLoadMod } from "@spt/models/external/IPreSptLoadMod";
import { InsuranceServiceExtension } from "./InsuranceServiceExtension";
import { InsuranceControllerExtension } from "./InsuranceControllerExtension";
import { ILogger } from "@spt/models/spt/utils/ILogger";

class Mod implements IPreSptLoadMod {

    preSptLoad(container: DependencyContainer): void {
        const logger = container.resolve<ILogger>("WinstonLogger");
        container.register<InsuranceServiceExtension>("InsuranceServiceExtension", InsuranceServiceExtension);
        container.register<InsuranceControllerExtension>("InsuranceControllerExtension", InsuranceControllerExtension);
        container.register("InsuranceService", { useToken: "InsuranceServiceExtension" });
        container.register("InsuranceController", { useToken: "InsuranceControllerExtension" });
    }
}

export const mod = new Mod();
