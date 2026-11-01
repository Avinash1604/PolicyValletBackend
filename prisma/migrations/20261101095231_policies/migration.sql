-- CreateEnum
CREATE TYPE "PolicyCategory" AS ENUM ('HEALTH', 'LIFE', 'MOTOR', 'HOME', 'TRAVEL', 'TERM', 'OTHER');

-- CreateEnum
CREATE TYPE "PremiumFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'SINGLE');

-- CreateEnum
CREATE TYPE "Relationship" AS ENUM ('SELF', 'SPOUSE', 'CHILD', 'PARENT', 'SIBLING', 'OTHER');

-- CreateTable
CREATE TABLE "policies" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "category" "PolicyCategory" NOT NULL,
    "provider" TEXT NOT NULL,
    "policy_number" TEXT NOT NULL,
    "notes" TEXT,
    "sum_insured" DECIMAL(14,2) NOT NULL,
    "premium_amount" DECIMAL(12,2) NOT NULL,
    "premium_frequency" "PremiumFrequency" NOT NULL,
    "start_date" DATE NOT NULL,
    "expiry_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_members" (
    "id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "relationship" "Relationship" NOT NULL,
    "date_of_birth" DATE,

    CONSTRAINT "policy_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_shares" (
    "id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "user_id" TEXT,
    "invite_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "policies_owner_id_idx" ON "policies"("owner_id");

-- CreateIndex
CREATE INDEX "policies_expiry_date_idx" ON "policies"("expiry_date");

-- CreateIndex
CREATE INDEX "policy_members_policy_id_idx" ON "policy_members"("policy_id");

-- CreateIndex
CREATE INDEX "policy_shares_user_id_idx" ON "policy_shares"("user_id");

-- CreateIndex
CREATE INDEX "policy_shares_invite_email_idx" ON "policy_shares"("invite_email");

-- CreateIndex
CREATE UNIQUE INDEX "policy_shares_policy_id_user_id_key" ON "policy_shares"("policy_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "policy_shares_policy_id_invite_email_key" ON "policy_shares"("policy_id", "invite_email");

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_members" ADD CONSTRAINT "policy_members_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_shares" ADD CONSTRAINT "policy_shares_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_shares" ADD CONSTRAINT "policy_shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
