# Insurance Fraud

All insured gear that you drop in the middle of a raid will return back to you 100% of the time regardless of trader insurance rates.

## **Overview**

This mod *somewhat* simulates insurance fraud in live EFT by ensuring that all dropped and insured gear will return back to you with 100% return rates (imagine you hid it in a bush or something).

By default, SPT insurance works through percentage rates that are set to 75% and 85% if you insure through Prapor or Therapist respectively.  This rate will still apply for all insured gear that is equipped if you die in a raid, but any other insured gear that was dropped or moved to a container outside the inventory will be affected by this mod.  

## **Background**

I was interested in making a mod like this so that I can feel better about dropping my guns in raid and found a lot of good direction on what and where to edit from looking through the source code of Insurance Plus by Mattdokn.  Thanks a lot!

## **Install**

Extract directly into the SPT folder.  Mod folder can be located in user/mods/.

## **Specifics**

The mod overrides functions in /spt/services/InsuranceService.ts and /spt/src/controllers/InsuranceController.ts.  The mod extends the Item class with an additional property (dropped: boolean) and uses it as a flag for gear that's missing in post-raid gear, creating some conditionals that will move the gear through the deletion helper functions without getting deleted.  After the insurance package is handled, the dropped property is cleaned up on all items.

## **Issues**

Insured armor will come back with similar durability as to what it had when you entered the raid.

Please let me know if you encounter any issues, testing insurance is very time-consuming.


## **Other Mods**

I recommend using [Server Value Modifier [SVM]]((https://hub.sp-tarkov.com/files/file/379-server-value-modifier-svm)) for modifying your base insurance values such trader insurance return rates and insurance return times.  Any mods that do not modify the above functions in InsuranceService.ts and InsuranceController.ts should be compatible, but let me know if any issues are being experienced.
