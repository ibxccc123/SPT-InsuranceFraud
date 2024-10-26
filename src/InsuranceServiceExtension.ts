import { InsuranceService } from "@spt/services/InsuranceService";
import { DialogueHelper } from "@spt/helpers/DialogueHelper";
import { HandbookHelper } from "@spt/helpers/HandbookHelper";
import { ItemHelper } from "@spt/helpers/ItemHelper";
import { ProfileHelper } from "@spt/helpers/ProfileHelper";
import { SecureContainerHelper } from "@spt/helpers/SecureContainerHelper";
import { TraderHelper } from "@spt/helpers/TraderHelper";
import { IPmcData } from "@spt/models/eft/common/IPmcData";
import { Item } from "@spt/models/eft/common/tables/IItem";
import { ITraderBase } from "@spt/models/eft/common/tables/ITrader";
import { IInsuredItemsData } from "@spt/models/eft/inRaid/IInsuredItemsData";
import { ISaveProgressRequestData } from "@spt/models/eft/inRaid/ISaveProgressRequestData";
import { BonusType } from "@spt/models/enums/BonusType";
import { ConfigTypes } from "@spt/models/enums/ConfigTypes";
import { ItemTpl } from "@spt/models/enums/ItemTpl";
import { MessageType } from "@spt/models/enums/MessageType";
import { IInsuranceConfig } from "@spt/models/spt/config/IInsuranceConfig";
import { ILostOnDeathConfig } from "@spt/models/spt/config/ILostOnDeathConfig";
import { IInsuranceEquipmentPkg } from "@spt/models/spt/services/IInsuranceEquipmentPkg";
import { ILogger } from "@spt/models/spt/utils/ILogger";
import { ConfigServer } from "@spt/servers/ConfigServer";
import { SaveServer } from "@spt/servers/SaveServer";
import { DatabaseService } from "@spt/services/DatabaseService";
import { LocaleService } from "@spt/services/LocaleService";
import { LocalisationService } from "@spt/services/LocalisationService";
import { MailSendService } from "@spt/services/MailSendService";
import { HashUtil } from "@spt/utils/HashUtil";
import { RandomUtil } from "@spt/utils/RandomUtil";
import { TimeUtil } from "@spt/utils/TimeUtil";
import { ICloner } from "@spt/utils/cloners/ICloner";
import { inject, injectable } from "tsyringe";

@injectable()

export class InsuranceServiceExtension extends InsuranceService {

    constructor(
        @inject("PrimaryLogger") protected logger: ILogger,
        @inject("DatabaseService") protected databaseService: DatabaseService,
        @inject("SecureContainerHelper") protected secureContainerHelper: SecureContainerHelper,
        @inject("RandomUtil") protected randomUtil: RandomUtil,
        @inject("ItemHelper") protected itemHelper: ItemHelper,
        @inject("HashUtil") protected hashUtil: HashUtil,
        @inject("TimeUtil") protected timeUtil: TimeUtil,
        @inject("SaveServer") protected saveServer: SaveServer,
        @inject("TraderHelper") protected traderHelper: TraderHelper,
        @inject("DialogueHelper") protected dialogueHelper: DialogueHelper,
        @inject("HandbookHelper") protected handbookHelper: HandbookHelper,
        @inject("LocalisationService") protected localisationService: LocalisationService,
        @inject("LocaleService") protected localeService: LocaleService,
        @inject("MailSendService") protected mailSendService: MailSendService,
        @inject("ConfigServer") protected configServer: ConfigServer,
        @inject("PrimaryCloner") protected cloner: ICloner,
        @inject("ProfileHelper") protected profileHelper: ProfileHelper,
    ) {
        super(
            logger,
            databaseService,
            secureContainerHelper,
            randomUtil,
            itemHelper,
            hashUtil,
            timeUtil,
            saveServer,
            traderHelper,
            dialogueHelper,
            handbookHelper,
            localisationService,
            localeService,
            mailSendService,
            configServer,
            cloner,
            profileHelper
        );
    }

    /**
     * Create insurance equipment packages that should be sent to the user. The packages should contain items that have
     * been lost in a raid and should be returned to the player through the insurance system.
     *
     * NOTE: We do not have data on items that were dropped in a raid. This means we have to pull item data from the
     *       profile at the start of the raid to return to the player in insurance. Because of this, the item
     *       positioning may differ from the position the item was in when the player died. Apart from removing all
     *       positioning, this is the best we can do. >:{}
     *
     * @param pmcData Player profile
     * @param offraidData Post-raid data
     * @param preRaidGear Pre-raid data
     * @param sessionID Session id
     * @param playerDied Did player die in raid
     * @returns Array of insured items lost in raid
     */
    public override getGearLostInRaid(
        pmcData: IPmcData,
        offraidData: ISaveProgressRequestData,
        preRaidGear: Item[],
        sessionID: string,
        playerDied: boolean,
    ): IInsuranceEquipmentPkg[] {
        const equipmentPkg: IInsuranceEquipmentPkg[] = [];
        const preRaidGearMap = this.itemHelper.generateItemsMap(preRaidGear);
        const offRaidGearMap = this.itemHelper.generateItemsMap(offraidData.profile.Inventory.items);

        for (const insuredItem of pmcData.InsuredItems) {
            // Skip insured items not on player when they started the raid.
            if (!preRaidGearMap.has(insuredItem.itemId)) {
                continue;
            }

            const preRaidItem = preRaidGearMap.get(insuredItem.itemId)!;

            // Skip slots we should never return as they're never lost on death
            if (this.insuranceConfig.blacklistedEquipment.includes(preRaidItem.slotId!)) {
                continue;
            }

            // Equipment slots can be flagged as never lost on death and shouldn't be saved in an insurance package.
            // We need to check if the item is directly equipped to an equipment slot, or if it is a child Item of an
            // equipment slot.
            const equipmentParentItem = this.itemHelper.getEquipmentParent(preRaidItem._id, preRaidGearMap);

            const offraidDataitem = offraidData.insurance?.find(
                (insuranceItem) => insuranceItem.id === insuredItem.itemId,
            );

            if (offraidDataitem?.usedInQuest) {
                continue;
            }

            // Now that we have the equipment parent item, we can check to see if that item is located in an equipment
            // slot that is flagged as lost on death. If it is, then the itemShouldBeLostOnDeath.
            const itemShouldBeLostOnDeath = equipmentParentItem?.slotId
                ? this.lostOnDeathConfig.equipment[equipmentParentItem?.slotId] ?? true
                : true;

            // Was the item found in the player inventory post-raid?
            const itemOnPlayerPostRaid = offRaidGearMap.has(insuredItem.itemId);

            // Check if item missing in post-raid gear OR player died + item slot flagged as lost on death
            // Catches both events: player died with item on + player survived but dropped item in raid
            if (!itemOnPlayerPostRaid || (playerDied && itemShouldBeLostOnDeath)) {
                const inventoryInsuredItem = offraidData.insurance?.find(
                    (insuranceItem) => insuranceItem.id === insuredItem.itemId,
                );
                if (!inventoryInsuredItem) {
                    throw new Error(
                        this.localisationService.getText(
                            "insurance-item_not_found_in_post_raid_data",
                            insuredItem.itemId,
                        ),
                    );
                }

                const item = this.getInsuredItemDetails(pmcData, preRaidItem, inventoryInsuredItem);
                
                //Sets the item's dropped property to whether the item is missing in post-raid gear (dropped on ground)
                item.dropped = !itemOnPlayerPostRaid;

                equipmentPkg.push({
                    pmcData: pmcData,
                    itemToReturnToPlayer: item,
                    traderId: insuredItem.tid,
                    sessionID: sessionID,
                });

                // Armor item with slots, we need to include soft_inserts as they can never be removed from armor items
                if (this.itemHelper.armorItemCanHoldMods(preRaidItem._tpl)) {
                    if (this.itemHelper.itemHasSlots(preRaidItem._tpl)) {
                        // Get IDs of all soft insert child items on armor from pre raid gear data
                        const softInsertChildIds = preRaidGear
                            .filter(
                                (item) =>
                                    item.parentId === preRaidItem._id &&
                                    this.itemHelper.getSoftInsertSlotIds().includes(item.slotId!.toLowerCase()),
                            )
                            .map((x) => x._id);

                        // Add all items found above to return data
                        for (const softInsertChildModId of softInsertChildIds) {
                            const preRaidInventoryItem = preRaidGear.find((item) => item._id === softInsertChildModId);
                            if (!preRaidInventoryItem) {
                                throw new Error(
                                    this.localisationService.getText(
                                        "insurance-pre_raid_item_not_found",
                                        softInsertChildModId,
                                    ),
                                );
                            }
                            const inventoryInsuredItem = offraidData.insurance?.find(
                                (insuranceItem) => insuranceItem.id === softInsertChildModId,
                            );
                            if (!inventoryInsuredItem) {
                                throw new Error(
                                    this.localisationService.getText(
                                        "insurance-post_raid_item_not_found",
                                        softInsertChildModId,
                                    ),
                                );
                            }
                            
                            const item = this.getInsuredItemDetails(pmcData, preRaidInventoryItem, inventoryInsuredItem);
                            item.dropped = !itemOnPlayerPostRaid;

                            equipmentPkg.push({
                                pmcData: pmcData,
                                itemToReturnToPlayer: item,
                                traderId: insuredItem.tid,
                                sessionID: sessionID,
                            });
                        }
                    }
                }
            }
        }

        return equipmentPkg;
    }

}