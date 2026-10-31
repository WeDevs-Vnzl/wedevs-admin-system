-- AlterTable
ALTER TABLE "BillingPlan" ADD COLUMN     "contractedUsd" DECIMAL(18,2),
ADD COLUMN     "usdRate" DECIMAL(20,8);

-- AlterTable
ALTER TABLE "RecurringCharge" ADD COLUMN     "resumedOn" DATE;

-- AlterTable
ALTER TABLE "RecurringExpense" ADD COLUMN     "resumedOn" DATE;
