import dashboardHtml from './dashboard.html';
import {
    authenticate,
    createErrorResponse,
    dispatchRequest,
    handleDashboard as handleDashboardImpl,
    handleSubscribers,
    handleSummary
} from './lib.mjs';

export { authenticate, handleSubscribers, handleSummary };

export async function handleDashboard(request, env) {
    return handleDashboardImpl(request, env, dashboardHtml);
}

export default {
    async fetch(request, env) {
        try {
            return await dispatchRequest(request, env, dashboardHtml);
        } catch (error) {
            return createErrorResponse(request, error);
        }
    }
};
