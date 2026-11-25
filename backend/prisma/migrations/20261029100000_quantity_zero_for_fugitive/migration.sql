-- A refrigerant mass balance can have no top-up (workbook WE-13: P = 0, disposed 20, recovered 18).
-- The API still requires quantity > 0 for every other kind of source (activities.controller.ts).
ALTER TABLE "ActivityRecord" DROP CONSTRAINT "ActivityRecord_quantity_check";
ALTER TABLE "ActivityRecord" ADD CONSTRAINT "ActivityRecord_quantity_check" CHECK ("quantity" >= 0);
