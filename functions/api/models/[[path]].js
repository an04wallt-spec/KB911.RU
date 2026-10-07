import { api } from '../../_models.js';
export function onRequest(context) { return api(context.request, context.env); }
