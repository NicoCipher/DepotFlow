/** Business-specific, owner-scoped read-only setup data.
 * Never interpret technicalChecklistComplete as authorization to activate.
 */
export type OpeningReadinessSnapshot = {
  businessId: string;
  businessStatus: string;
  profile: { name: string; address: string; phone: string } | null;
  configured: {
    activeDrinks: number;
    crateTypes: number;
    returnableBottleTypes: number;
    activeCustomers: number;
  };
  physicalOpening: {
    missingDrinks: number;
    missingCrates: number;
    missingBottleTypes: number;
    missingDrinkIds: string[];
    missingCrateTypeIds: string[];
    missingBottleTypeLabels: string[];
    unconfiguredReturnables: number;
    changedAfterOpening: number;
  };
  customerOpening: {
    customersWithOpening: number;
    customersWithoutOpening: number;
    historicalDebtNaira: number;
    refundableDepositsHeldNaira: number;
    customerCratesOwed: number;
    customerBottlesOwed: number;
    accountMismatches: number;
  };
  operationalEventsBeforeCutover: number;
  technicalChecklistComplete: boolean;
  customerHistoryAttestationRequired: boolean;
  canActivate: false;
};

export type OpeningChecklistItem = {
  id: "profile" | "drinks" | "stock" | "crates" | "bottles" | "accounts" | "customer-history" | "previous-activity";
  label: string;
  description: string;
  status: "done" | "action" | "confirm";
};

export function openingChecklist(s: OpeningReadinessSnapshot): OpeningChecklistItem[] {
  const p = s.physicalOpening;
  const c = s.customerOpening;
  return [
    {
      id: "profile",
      label: "Business details",
      description: s.profile?.name ? s.profile.name : "Add your depot name and contact details",
      status: s.profile?.name ? "done" : "action",
    },
    {
      id: "drinks",
      label: "Drinks and prices",
      description: s.configured.activeDrinks > 0
        ? `${s.configured.activeDrinks} drinks selected; check selling prices before launch`
        : "Choose the drinks this depot sells",
      status: s.configured.activeDrinks > 0 ? "confirm" : "action",
    },
    {
      id: "stock",
      label: "Opening drink stock",
      description: p.missingDrinks
        ? `Count ${p.missingDrinks} drinks — a missing count is not zero`
        : "All active drinks have a recorded starting count",
      status: p.missingDrinks || p.changedAfterOpening ? "action" : "done",
    },
    {
      id: "crates",
      label: "Empty crates in the depot",
      description: p.missingCrates
        ? `Count ${p.missingCrates} physical crate types`
        : "Physical crate types counted, including confirmed zeros",
      status: p.missingCrates || p.changedAfterOpening ? "action" : "done",
    },
    {
      id: "bottles",
      label: "Empty bottles in the depot",
      description: p.unconfiguredReturnables
        ? `${p.unconfiguredReturnables} drinks need a valid returnable bottle type`
        : p.missingBottleTypes
          ? `Count ${p.missingBottleTypes} returnable bottle types`
          : "Physical bottle types counted, including confirmed zeros",
      status: p.missingBottleTypes || p.unconfiguredReturnables || p.changedAfterOpening ? "action" : "done",
    },
    {
      id: "accounts",
      label: "Customer balances",
      description: c.accountMismatches
        ? `${c.accountMismatches} customer accounts need reconciliation`
        : "Existing debts, held deposits and owed empties agree with opening records",
      status: c.accountMismatches ? "action" : "done",
    },
    {
      id: "customer-history",
      label: "Customers with no old balance recorded",
      description: `${c.customersWithoutOpening} active customers need an explicit history check, even if they owed nothing`,
      status: "confirm",
    },
    {
      id: "previous-activity",
      label: "No trading before cutover",
      description: s.operationalEventsBeforeCutover
        ? `${s.operationalEventsBeforeCutover} operational events require investigation`
        : "No sale, payment or receiving activity recorded before setup",
      status: s.operationalEventsBeforeCutover ? "action" : "done",
    },
  ];
}

export function canPresentOwnerSignoff(s: OpeningReadinessSnapshot): boolean {
  // This merely enables presenting REVIEW acknowledgments when wired.
  // It never authorizes a status change or sale.
  return s.businessStatus === "setup" && s.technicalChecklistComplete
    && openingChecklist(s).every((item) => item.status !== "action");
}
