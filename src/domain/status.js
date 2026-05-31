export const statusLabels = {
  unchecked: "미점검",
  keep: "유지",
  watch: "주의",
  reroute: "우회"
};

export function toItemStatus(decisionStatus) {
  if (decisionStatus === "keep") return "keep";
  if (decisionStatus === "watch") return "watch";
  return "reroute";
}
