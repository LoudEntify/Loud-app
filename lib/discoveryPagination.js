// Preserve feed order while refreshing entries that overlap adjacent pages.
export function mergeDiscoveryItems(existing, incoming) {
  return [...new Map([...existing, ...incoming].map(item => [item.id, item])).values()];
}
