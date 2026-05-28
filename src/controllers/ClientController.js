"use strict";

/**
 * @fileoverview HTTP controller for the /api/v1/client resource.
 *
 * Thin layer: validates nothing beyond HTTP concerns, delegates all logic to
 * ClientService. Every async method is wrapped in catchAsync — unhandled
 * rejections route to ErrorHandlerMiddleware.
 */

const { catchAsync } = require("../utils/catchAsync");
const { sendSuccess, RESPONSE_MESSAGES, HTTP_STATUS } = require("../constants");
const ClientService = require("../services/ClientService");

class ClientController {
    /**
     * POST /api/v1/client/errors
     * Ingests a structured client-side render error report (from the
     * frontend ErrorBoundary via clientLogger).
     */
    static logError = catchAsync(async (req, res) => {
        await ClientService.logError(req.body, req.user);
        res
            .status(HTTP_STATUS.OK)
            .json(sendSuccess(RESPONSE_MESSAGES.CLIENT_ERROR_LOGGED));
    });
}

module.exports = ClientController;
