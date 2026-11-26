export function normalizeModelId(id) {
  return String(id || '').trim().replace(/-wm$/, '');
}

export function mergeModels(...sources) {
  const out = [];
  const seen = new Set();
  for (const source of sources) {
    for (const model of Array.isArray(source) ? source : []) {
      if (!model || model.visibility === 'hide' || model.supported_in_api === false) continue;
      const id = normalizeModelId(model.slug || model.id || model.name);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        ...model,
        id,
        slug: id,
        displayName: model.displayName || model.display_name || model.title || id,
        owned_by: model.owned_by || model.provider || 'openai',
        capabilities: model.capabilities || (id.startsWith('gpt-image-') ? ['image'] : ['chat']),
        protocol: model.protocol || 'openai-chat',
        source: model.source || 'discovered',
      });
    }
  }
  return out;
}

export function mergeCodexModels(codex = {}, web = {}) {
  const webModels = (web.models || []).filter((m) => {
    const id = String(m?.slug || m?.id || '');
    return id.endsWith('-wm') || /^gpt-image(?:-|$)/i.test(id);
  });
  return mergeModels(codex.models, webModels);
}
