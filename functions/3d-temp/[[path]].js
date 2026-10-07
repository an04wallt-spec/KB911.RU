import { serve } from '../_models.js';
export function onRequest(context) { return serve(context.request, context.env, context.params.path); }
