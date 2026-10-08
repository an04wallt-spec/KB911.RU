// Only aggregate project counts; no visitor identifiers or model content.
export async function countView(env, project) {
  if (!env.MODEL_VIEWS) return;
  try {
    await env.MODEL_VIEWS.prepare('INSERT INTO project_views (project, views) VALUES (?, 1) ON CONFLICT(project) DO UPDATE SET views = project_views.views + 1').bind(project).run();
  } catch { console.error('Model view counter unavailable'); }
}
export async function projectViews(env, names) {
  if (!env.MODEL_VIEWS) return null;
  const counts = new Map();
  try {
    for (let offset = 0; offset < names.length; offset += 50) {
      const batch = names.slice(offset, offset + 50);
      const result = await env.MODEL_VIEWS.prepare('SELECT project, views FROM project_views WHERE project IN (' + batch.map(() => '?').join(',') + ')').bind(...batch).all();
      if (!result.success) return null;
      for (const row of result.results) counts.set(row.project, Number(row.views));
    }
    return counts;
  } catch { console.error('Model view statistics unavailable'); return null; }
}
