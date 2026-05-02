import dashboardHtml from './dashboard.html';
import {
    authenticate,
    createErrorResponse,
    dispatchRequest,
    handleDashboard as handleDashboardImpl,
    handleSession,
    handleStatsInstalls,
    handleStatsSummary,
    handleSubscribers,
    handleSummary,
    readonlySelect
} from './lib.mjs';

export {
    authenticate,
    handleSession,
    handleStatsInstalls,
    handleStatsSummary,
    handleSubscribers,
    handleSummary,
    readonlySelect
};

export async function handleDashboard(request, env) {
    return handleDashboardImpl(request, env, dashboardHtml);
}

export default {
    async fetch(request, env) {
        try {
            return await dispatchRequest(request, env, dashboardHtml);
        } catch (error) {
            return await createErrorResponse(request, error);
        }
    }
};
