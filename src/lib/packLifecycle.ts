import { supabase } from "./supabase";

export async function canUserDeletePack(
  userId: string,
  packId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("packs")
    .select("created_by")
    .eq("id", packId)
    .maybeSingle();
  return data?.created_by === userId;
}

export async function leavePack(
  userId: string,
  packId: string,
): Promise<void> {
  const { data: pack } = await supabase
    .from("packs")
    .select("created_by")
    .eq("id", packId)
    .maybeSingle();

  if (!pack) throw new Error("Pack not found.");

  if (pack.created_by === userId) {
    const { count } = await supabase
      .from("pack_members")
      .select("*", { count: "exact", head: true })
      .eq("pack_id", packId)
      .eq("is_active", true)
      .neq("user_id", userId);

    if ((count ?? 0) > 0) {
      throw new Error(
        "As the creator, you must delete the pack to leave. Transfer ownership is coming soon.",
      );
    }
    // Solo creator — fall through and soft-delete their membership
  }

  const { error } = await supabase
    .from("pack_members")
    .update({ is_active: false })
    .eq("user_id", userId)
    .eq("pack_id", packId);

  if (error) throw error;
}

export async function deletePack(
  packId: string,
  creatorId: string,
): Promise<void> {
  const canDelete = await canUserDeletePack(creatorId, packId);
  if (!canDelete) throw new Error("Only the creator can delete this pack.");

  const { error } = await supabase.rpc("delete_pack_cascade", {
    pack_id_to_delete: packId,
  });
  if (error) throw error;
}

export async function transferPackOwnership(
  packId: string,
  newOwnerId: string,
): Promise<void> {
  const { error } = await supabase.rpc("transfer_pack_ownership", {
    pack_id_to_transfer: packId,
    new_owner_user_id: newOwnerId,
  });
  if (error) throw new Error(`Transfer failed: ${error.message}`);
}
