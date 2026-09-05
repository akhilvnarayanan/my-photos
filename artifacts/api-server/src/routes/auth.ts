import { Router, type IRouter } from "express";
import { GetSessionResponse, LoginBody, LoginResponse } from "@workspace/api-zod";
import { clearSessionCookie, destroySession, getCurrentUser, login, setSessionCookie } from "../lib/auth";

const router: IRouter = Router();

router.get("/auth/session", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  res.json(GetSessionResponse.parse({ authenticated: Boolean(user), username: user?.username ?? null }));
});

router.post("/auth/session", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = await login(parsed.data.username, parsed.data.password);
  if (!result) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }
  setSessionCookie(res, result.id);
  res.json(LoginResponse.parse({ authenticated: true, username: result.user.username }));
});

router.delete("/auth/session", async (req, res): Promise<void> => {
  await destroySession(req);
  clearSessionCookie(res);
  res.sendStatus(204);
});

export default router;