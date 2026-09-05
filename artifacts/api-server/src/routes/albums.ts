import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, albumPhotosTable, albumsTable, photosTable } from "@workspace/db";
import { AddPhotosToAlbumBody, AddPhotosToAlbumParams, AddPhotosToAlbumResponse, CreateAlbumBody, CreateAlbumResponse, DeleteAlbumParams, RemovePhotoFromAlbumParams, UpdateAlbumBody, UpdateAlbumParams, UpdateAlbumResponse, ListAlbumsResponse } from "@workspace/api-zod";
import { requireUser } from "../lib/auth";

const router: IRouter = Router();
router.use("/albums", requireUser);

async function albumResponse(album: typeof albumsTable.$inferSelect) {
  const [count] = await db.select({ count: sql<number>`count(*)` }).from(albumPhotosTable).where(eq(albumPhotosTable.albumId, album.id));
  const [cover] = await db.select({ id: photosTable.id }).from(albumPhotosTable)
    .innerJoin(photosTable, eq(albumPhotosTable.photoId, photosTable.id))
    .where(eq(albumPhotosTable.albumId, album.id))
    .orderBy(desc(photosTable.captureDate)).limit(1);
  return {
    id: album.id,
    name: album.name,
    photoCount: Number(count?.count ?? 0),
    coverUrl: cover ? `/api/photos/${cover.id}/thumbnail` : null,
    createdAt: album.createdAt,
    updatedAt: album.updatedAt,
  };
}

router.get("/albums", async (_req, res): Promise<void> => {
  const rows = await db.select().from(albumsTable).where(eq(albumsTable.userId, res.locals.user.userId)).orderBy(desc(albumsTable.updatedAt));
  res.json(ListAlbumsResponse.parse(await Promise.all(rows.map(albumResponse))));
});

router.post("/albums", async (req, res): Promise<void> => {
  const parsed = CreateAlbumBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const id = crypto.randomUUID();
  const [album] = await db.insert(albumsTable).values({ id, userId: res.locals.user.userId, name: parsed.data.name }).onConflictDoNothing().returning();
  const result = album ?? (await db.select().from(albumsTable)
    .where(and(eq(albumsTable.userId, res.locals.user.userId), eq(albumsTable.name, parsed.data.name))).limit(1))[0];
  if (!result) {
    res.status(409).json({ error: "An album with that name already exists" });
    return;
  }
  res.status(album ? 201 : 200).json(CreateAlbumResponse.parse(await albumResponse(result)));
});

router.patch("/albums/:albumId", async (req, res): Promise<void> => {
  const params = UpdateAlbumParams.safeParse(req.params);
  const body = UpdateAlbumBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  let album: typeof albumsTable.$inferSelect | undefined;
  try {
    [album] = await db.update(albumsTable).set({ name: body.data.name, updatedAt: new Date() })
      .where(and(eq(albumsTable.id, params.data.albumId), eq(albumsTable.userId, res.locals.user.userId))).returning();
  } catch {
    res.status(409).json({ error: "An album with that name already exists" });
    return;
  }
  if (!album) {
    res.status(404).json({ error: "Album not found" });
    return;
  }
  res.json(UpdateAlbumResponse.parse(await albumResponse(album)));
});

router.delete("/albums/:albumId", async (req, res): Promise<void> => {
  const params = DeleteAlbumParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [album] = await db.delete(albumsTable).where(and(eq(albumsTable.id, params.data.albumId), eq(albumsTable.userId, res.locals.user.userId))).returning();
  if (!album) {
    res.status(404).json({ error: "Album not found" });
    return;
  }
  await db.delete(albumPhotosTable).where(eq(albumPhotosTable.albumId, album.id));
  res.sendStatus(204);
});

router.post("/albums/:albumId/photos", async (req, res): Promise<void> => {
  const params = AddPhotosToAlbumParams.safeParse(req.params);
  const body = AddPhotosToAlbumBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [album] = await db.select().from(albumsTable).where(and(eq(albumsTable.id, params.data.albumId), eq(albumsTable.userId, res.locals.user.userId))).limit(1);
  if (!album) {
    res.status(404).json({ error: "Album not found" });
    return;
  }
  const ownedPhotos = await db.select({ id: photosTable.id }).from(photosTable)
    .where(and(eq(photosTable.userId, res.locals.user.userId), inArray(photosTable.id, body.data.photoIds)));
  if (ownedPhotos.length !== body.data.photoIds.length) {
    res.status(400).json({ error: "One or more photos are not available to this user" });
    return;
  }
  for (const photoId of body.data.photoIds) {
    await db.insert(albumPhotosTable).values({ albumId: album.id, photoId }).onConflictDoNothing();
  }
  await db.update(albumsTable).set({ updatedAt: new Date() }).where(eq(albumsTable.id, album.id));
  res.json(AddPhotosToAlbumResponse.parse(await albumResponse({ ...album, updatedAt: new Date() })));
});

router.delete("/albums/:albumId/photos/:photoId", async (req, res): Promise<void> => {
  const params = RemovePhotoFromAlbumParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [album] = await db.select({ id: albumsTable.id }).from(albumsTable)
    .where(and(eq(albumsTable.id, params.data.albumId), eq(albumsTable.userId, res.locals.user.userId))).limit(1);
  if (!album) {
    res.status(404).json({ error: "Album not found" });
    return;
  }
  await db.delete(albumPhotosTable).where(and(eq(albumPhotosTable.albumId, params.data.albumId), eq(albumPhotosTable.photoId, params.data.photoId)));
  res.sendStatus(204);
});

export default router;