import { InsuranceController } from "@spt/controllers/InsuranceController";
import { DialogueHelper } from "@spt/helpers/DialogueHelper";
import { ItemHelper } from "@spt/helpers/ItemHelper";
import { ProfileHelper } from "@spt/helpers/ProfileHelper";
import { TraderHelper } from "@spt/helpers/TraderHelper";
import { WeightedRandomHelper } from "@spt/helpers/WeightedRandomHelper";
import { IPmcData } from "@spt/models/eft/common/IPmcData";
import { Item } from "@spt/models/eft/common/tables/IItem";
import { IGetInsuranceCostRequestData } from "@spt/models/eft/insurance/IGetInsuranceCostRequestData";
import { IGetInsuranceCostResponseData } from "@spt/models/eft/insurance/IGetInsuranceCostResponseData";
import { IInsureRequestData } from "@spt/models/eft/insurance/IInsureRequestData";
import { IItemEventRouterResponse } from "@spt/models/eft/itemEvent/IItemEventRouterResponse";
import { Insurance } from "@spt/models/eft/profile/ISptProfile";
import { IProcessBuyTradeRequestData } from "@spt/models/eft/trade/IProcessBuyTradeRequestData";
import { ConfigTypes } from "@spt/models/enums/ConfigTypes";
import { Money } from "@spt/models/enums/Money";
import { SkillTypes } from "@spt/models/enums/SkillTypes";
import { IInsuranceConfig } from "@spt/models/spt/config/IInsuranceConfig";
import { ILogger } from "@spt/models/spt/utils/ILogger";
import { EventOutputHolder } from "@spt/routers/EventOutputHolder";
import { ConfigServer } from "@spt/servers/ConfigServer";
import { SaveServer } from "@spt/servers/SaveServer";
import { DatabaseService } from "@spt/services/DatabaseService";
import { InsuranceService } from "@spt/services/InsuranceService";
import { LocalisationService } from "@spt/services/LocalisationService";
import { MailSendService } from "@spt/services/MailSendService";
import { PaymentService } from "@spt/services/PaymentService";
import { RagfairPriceService } from "@spt/services/RagfairPriceService";
import { HashUtil } from "@spt/utils/HashUtil";
import { MathUtil } from "@spt/utils/MathUtil";
import { ProbabilityObject, ProbabilityObjectArray, RandomUtil } from "@spt/utils/RandomUtil";
import { TimeUtil } from "@spt/utils/TimeUtil";
import { ICloner } from "@spt/utils/cloners/ICloner";
import { inject, injectable } from "tsyringe";


@injectable()

export class InsuranceControllerExtension extends InsuranceController {

    constructor(
        @inject("PrimaryLogger") protected logger: ILogger,
        @inject("RandomUtil") protected randomUtil: RandomUtil,
        @inject("MathUtil") protected mathUtil: MathUtil,
        @inject("HashUtil") protected hashUtil: HashUtil,
        @inject("EventOutputHolder") protected eventOutputHolder: EventOutputHolder,
        @inject("TimeUtil") protected timeUtil: TimeUtil,
        @inject("SaveServer") protected saveServer: SaveServer,
        @inject("DatabaseService") protected databaseService: DatabaseService,
        @inject("ItemHelper") protected itemHelper: ItemHelper,
        @inject("ProfileHelper") protected profileHelper: ProfileHelper,
        @inject("DialogueHelper") protected dialogueHelper: DialogueHelper,
        @inject("WeightedRandomHelper") protected weightedRandomHelper: WeightedRandomHelper,
        @inject("TraderHelper") protected traderHelper: TraderHelper,
        @inject("PaymentService") protected paymentService: PaymentService,
        @inject("InsuranceService") protected insuranceService: InsuranceService,
        @inject("MailSendService") protected mailSendService: MailSendService,
        @inject("RagfairPriceService") protected ragfairPriceService: RagfairPriceService,
        @inject("LocalisationService") protected localisationService: LocalisationService,
        @inject("ConfigServer") protected configServer: ConfigServer,
        @inject("PrimaryCloner") protected cloner: ICloner,
    ) {
        super(
            logger,
            randomUtil,
            mathUtil,
            hashUtil,
            eventOutputHolder,
            timeUtil,
            saveServer,
            databaseService,
            itemHelper,
            profileHelper,
            dialogueHelper,
            weightedRandomHelper,
            traderHelper,
            paymentService,
            insuranceService,
            mailSendService,
            ragfairPriceService,
            localisationService,
            configServer,
            cloner
        );
    }

    /**
     * This method orchestrates the processing of insured items in a profile.
     *
     * @param insuranceDetails The insured items to process.
     * @param sessionID The session ID that should receive the processed items.
     * @returns void
     */
    protected override processInsuredItems(insuranceDetails: Insurance[], sessionID: string): void {
        this.logger.debug(
            `Processing ${insuranceDetails.length} insurance packages, which includes a total of ${this.countAllInsuranceItems(
                insuranceDetails,
            )} items, in profile ${sessionID}`,
        );

        // Fetch the root Item parentId property value that should be used for insurance packages.
        const rootItemParentID = this.insuranceService.getRootItemParentID(sessionID);

        // Iterate over each of the insurance packages.
        for (const insured of insuranceDetails) {
            // Find items that should be deleted from the insured items.
            const itemsToDelete = this.findItemsToDelete(rootItemParentID, insured);

            // Actually remove them.
            this.removeItemsFromInsurance(insured, itemsToDelete);

            // Ensure that all items have a valid parent.
            insured.items = this.itemHelper.adoptOrphanedItems(rootItemParentID, insured.items);

            // Deletes the dropped property for alls item returned back to player
            for (let i in insured.items) {
                delete insured.items[i].dropped;
            }
            
            // Send the mail to the player.
            this.sendMail(sessionID, insured);

            // Remove the fully processed insurance package from the profile.
            this.removeInsurancePackageFromProfile(sessionID, insured);
        }
    }

    /**
     * Finds the items that should be deleted based on the given Insurance object.
     *
     * @param rootItemParentID - The ID that should be assigned to all "hideout"/root items.
     * @param insured - The insurance object containing the items to evaluate for deletion.
     * @returns A Set containing the IDs of items that should be deleted.
     */
    protected override findItemsToDelete(rootItemParentID: string, insured: Insurance): Set<string> {
        const toDelete = new Set<string>();

        // Populate a Map object of items for quick lookup by their ID and use it to populate a Map of main-parent items
        // and each of their attachments. For example, a gun mapped to each of its attachments.
        const itemsMap = this.itemHelper.generateItemsMap(insured.items);
        let parentAttachmentsMap = this.populateParentAttachmentsMap(rootItemParentID, insured, itemsMap);

        // Check to see if any regular items are present.
        const hasRegularItems = Array.from(itemsMap.values()).some(
            (item) => !this.itemHelper.isAttachmentAttached(item),
        );

        // Process all items that are not attached, attachments; those are handled separately, by value.
        if (hasRegularItems) {
            this.processRegularItems(insured, toDelete, parentAttachmentsMap);
        }

        // Process attached, attachments, by value, only if there are any.
        if (parentAttachmentsMap.size > 0) {
            // Remove attachments that can not be moddable in-raid from the parentAttachmentsMap. We only want to
            // process moddable attachments from here on out.
            parentAttachmentsMap = this.removeNonModdableAttachments(parentAttachmentsMap, itemsMap);

            this.processAttachments(parentAttachmentsMap, itemsMap, insured.traderId, toDelete);
        }

        // Log the number of items marked for deletion, if any
        if (toDelete.size) {
            this.logger.debug(`Marked ${toDelete.size} items for deletion from insurance.`);
        }

        return toDelete;
    }

    /**
     * Process "regular" insurance items. Any insured item that is not an attached, attachment is considered a "regular"
     * item. This method iterates over them, preforming item deletion rolls to see if they should be deleted. If so,
     * they (and their attached, attachments, if any) are marked for deletion in the toDelete Set.
     *
     * @param insured The insurance object containing the items to evaluate.
     * @param toDelete A Set to keep track of items marked for deletion.
     * @param parentAttachmentsMap A Map object containing parent item IDs to arrays of their attachment items.
     * @returns void
     */
    protected override processRegularItems(
        insured: Insurance,
        toDelete: Set<string>,
        parentAttachmentsMap: Map<string, Item[]>,
    ): void {
        for (const insuredItem of insured.items) {
            // Skip if the item is an attachment. These are handled separately.
            if (this.itemHelper.isAttachmentAttached(insuredItem)) {
                continue;
            }

            const itemRoll = this.rollForDelete(insured.traderId, insuredItem);
            if (itemRoll) {
                // Check to see if this item is a parent in the parentAttachmentsMap. If so, do a look-up for *all* of
                // its children and mark them for deletion as well. Additionally remove the parent (and its children)
                // from the parentAttachmentsMap so that it's children are not rolled for later in the process.
                if (parentAttachmentsMap.has(insuredItem._id)) {
                    // This call will also return the parent item itself, queueing it for deletion as well.
                    const itemAndChildren = this.itemHelper.findAndReturnChildrenAsItems(
                        insured.items,
                        insuredItem._id,
                    );
                    for (const item of itemAndChildren) {
                        //Deletes children if they were not dropped on ground during raid 
                        if(!item.dropped){ 
                            toDelete.add(item._id);
                        }
                    }

                    // Remove the parent (and its children) from the parentAttachmentsMap.
                    parentAttachmentsMap.delete(insuredItem._id);
                } else {
                    // This item doesn't have any children. Simply mark it for deletion.
                    toDelete.add(insuredItem._id);
                }
            }
        }
    }


    /**
     * Initialize a Map object that holds main-parents to all of their attachments. Note that "main-parent" in this
     * context refers to the parent item that an attachment is attached to. For example, a suppressor attached to a gun,
     * not the backpack that the gun is located in (the gun's parent).
     *
     * @param rootItemParentID - The ID that should be assigned to all "hideout"/root items.
     * @param insured - The insurance object containing the items to evaluate.
     * @param itemsMap - A Map object for quick item look-up by item ID.
     * @returns A Map object containing parent item IDs to arrays of their attachment items.
     */
    protected override populateParentAttachmentsMap(
        rootItemParentID: string,
        insured: Insurance,
        itemsMap: Map<string, Item>,
    ): Map<string, Item[]> {
        const mainParentToAttachmentsMap = new Map<string, Item[]>();
        for (const insuredItem of insured.items) {
            // Use the parent ID from the item to get the parent item.
            const parentItem = insured.items.find((item) => item._id === insuredItem.parentId);

            // The parent (not the hideout) could not be found. Skip and warn.
            if (!parentItem && insuredItem.parentId !== rootItemParentID) {
                this.logger.warning(
                    this.localisationService.getText("insurance-unable_to_find_parent_of_item", {
                        insuredItemId: insuredItem._id,
                        insuredItemTpl: insuredItem._tpl,
                        parentId: insuredItem.parentId,
                    }),
                );

                continue;
            }

            if (insuredItem.dropped != undefined) {
                //Item was dropped on the ground, skip this item and go to the next
                if(insuredItem.dropped) {
                    continue;
                }
            }

            // Check if this is an attachment currently attached to its parent.
            if (this.itemHelper.isAttachmentAttached(insuredItem)) {
                // Make sure the template for the item exists.
                if (!this.itemHelper.getItem(insuredItem._tpl)[0]) {
                    this.logger.warning(
                        this.localisationService.getText("insurance-unable_to_find_attachment_in_db", {
                            insuredItemId: insuredItem._id,
                            insuredItemTpl: insuredItem._tpl,
                        }),
                    );

                    continue;
                }

                // Get the main parent of this attachment. (e.g., The gun that this suppressor is attached to.)
                const mainParent = this.itemHelper.getAttachmentMainParent(insuredItem._id, itemsMap);
                if (!mainParent) {
                    // Odd. The parent couldn't be found. Skip this attachment and warn.
                    this.logger.warning(
                        this.localisationService.getText("insurance-unable_to_find_main_parent_for_attachment", {
                            insuredItemId: insuredItem._id,
                            insuredItemTpl: insuredItem._tpl,
                            parentId: insuredItem.parentId,
                        }),
                    );

                    continue;
                }

                // Update (or add to) the main-parent to attachments map.
                if (mainParentToAttachmentsMap.has(mainParent._id)) {
                    mainParentToAttachmentsMap.get(mainParent._id).push(insuredItem);
                } else {
                    mainParentToAttachmentsMap.set(mainParent._id, [insuredItem]);
                }
            }
        }
        return mainParentToAttachmentsMap;
    }


    /**
    * Determines whether an insured item should be removed from the player's inventory based on a random roll and
    * trader-specific return chance.
    *
    * @param traderId The ID of the trader who insured the item.
    * @param insuredItem Optional. The item to roll for. Only used for logging.
    * @returns true if the insured item should be removed from inventory, false otherwise, or undefined on error.
    */
    protected override rollForDelete(traderId: string, insuredItem?: Item): boolean | undefined {
        const trader = this.traderHelper.getTraderById(traderId);
        if (!trader) {
            return undefined;
        }

        const maxRoll = 9999;
        const conversionFactor = 100;

        const returnChance = this.randomUtil.getInt(0, maxRoll) / conversionFactor;
        const traderReturnChance = this.insuranceConfig.returnChancePercent[traderId];
        
        let roll = returnChance >= traderReturnChance;

        if (insuredItem != undefined) {
            //If the item's dropped is true, then roll will be set to false and item will return back to player
            if (insuredItem.dropped) {
                roll = false;
            }
        }

        // Log the roll with as much detail as possible.
        const itemName = insuredItem ? ` "${this.itemHelper.getItemName(insuredItem._tpl)}"` : "";
        const status = roll ? "Delete" : "Keep";
        this.logger.debug(
            `Rolling${itemName} with ${trader} - Return ${traderReturnChance}% - Roll: ${returnChance} - Status: ${status}`,
        );

        return roll;
    }
}
