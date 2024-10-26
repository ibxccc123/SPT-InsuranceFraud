import { Item } from "@spt/models/eft/common/tables/IItem";

//Extends the Item interface to add a new flag to check if the item is dropped
declare module '@spt/models/eft/common/tables/IItem' {
    interface Item {
        dropped?: boolean;
    }
}