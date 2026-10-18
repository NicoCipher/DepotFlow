"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/domain/ids";

export type RegisterDepotState = {
  name: string;
  address: string;
  phone: string;
  message: string;
};

export async function registerDepot(
  _previous: RegisterDepotState,
  formData: FormData,
): Promise<RegisterDepotState> {
  const name = String(formData.get("name") ?? "")
    .trim().replace(/\s+/g, " ").slice(0, 121);
  const address = String(formData.get("address") ?? "")
    .trim().replace(/\s+/g, " ").slice(0, 401);
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 41);
  const requestId = String(formData.get("request_id") ?? "");
  const invalid: RegisterDepotState = {
    name, address, phone,
    message: "Enter a business name (2–120 characters), address (up to 400) and phone (up to 40).",
  };

  if (
    !isUuid(requestId) || name.length < 2 || name.length > 120 ||
    address.length > 400 || phone.length > 40
  ) return invalid;

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return {
      name, address, phone,
      message: "Your session ended. Sign in and try again.",
    };
  }
  // This is NOT a service-role/admin call. Both the session and the DB's
  // confirmed-email/registration gate check must authorize the request.
  const { data: eligible, error: eligibleError } =
    await supabase.rpc("can_register_business");
  if (eligibleError || eligible !== true) {
    return {
      name, address, phone,
      message: "New depot registration is not available for this account.",
    };
  }

  const { data, error } = await supabase.rpc("register_my_business", {
    p_request_id: requestId,
    p_name: name,
    p_address: address,
    p_phone: phone,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data) ||
    typeof data.businessId !== "string" || !isUuid(data.businessId) ||
    data.canOperate !== false
  ) {
    return {
      name, address, phone,
      message: "Could not confirm registration. Check your depot list before trying again.",
    };
  }
  redirect(`/businesses/${data.businessId}/opening`);
}
