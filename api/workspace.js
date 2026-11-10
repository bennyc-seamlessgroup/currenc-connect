import {createVercelWorkspaceHandler} from '../server/vercel-workspace.mjs';

// Native Vercel function. Shared domain rules remain in the Worker build.
const handle = createVercelWorkspaceHandler();
export default {fetch:handle};
