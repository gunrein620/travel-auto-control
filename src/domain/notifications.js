export function createNotificationForDecision(item, decision) {
  if (decision.status === "keep") return null;

  return {
    id: `notice-${item.id}-${Date.now()}`,
    itemId: item.id,
    severity: decision.status,
    title: `${item.title} 점검 필요`,
    message: decision.summary,
    reason: decision.reason,
    recommendedAction: decision.recommendedAction,
    actionLabel: decision.suggestedPatch ? "우회안 적용" : "확인하기",
    suggestedPatch: decision.suggestedPatch,
    apiStatus: decision.apiStatus,
    createdAt: decision.checkedAt,
    dismissed: false
  };
}

export function applySuggestedPatch(item, patch) {
  return {
    ...item,
    ...patch,
    id: item.id,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    status: "unchecked",
    lastInspection: undefined
  };
}
