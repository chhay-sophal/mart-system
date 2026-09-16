import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireTerminal } from "../../middleware/requireTerminal";
import { loginSchema, pinLoginSchema, refreshSchema } from "./auth.schema";
import { login, logout, pinLogin, refreshTokens } from "./auth.service";
import { forbidden } from "../../lib/httpError";

export const authRouter: Router = Router();

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const tokens = await login(email, password);
    res.json(tokens);
  })
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    const tokens = await refreshTokens(refreshToken);
    res.json(tokens);
  })
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    await logout(refreshToken);
    res.status(204).end();
  })
);

authRouter.post(
  "/pin-login",
  requireTerminal,
  asyncHandler(async (req, res, next) => {
    const body = pinLoginSchema.parse(req.body);

    // The device credential (validated by requireTerminal) must belong to the
    // exact terminal/store the request claims — otherwise a valid terminal
    // could be used to brute-force PINs for a store it isn't paired to.
    if (req.terminal!.id !== body.terminalId || req.terminal!.storeId !== body.storeId) {
      return next(forbidden("Terminal credential does not match the requested terminal/store"));
    }

    const result = await pinLogin(body);
    res.json(result);
  })
);
