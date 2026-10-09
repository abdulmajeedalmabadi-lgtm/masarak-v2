import "dotenv/config";
import { Store } from "./store";
import { createApp } from "./app";
const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32)
  throw Error("Set JWT_SECRET to at least 32 random characters.");
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.PUBLIC_APP_URL?.startsWith("https://") ||
    !process.env.CORS_ORIGINS)
)
  throw Error(
    "Production requires HTTPS PUBLIC_APP_URL and explicit CORS_ORIGINS.",
  );
const store = new Store();
await store.load();
const { http, io, expire } = createApp(
  store,
  secret,
  (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(","),
);
const timer = setInterval(() => void expire().catch(console.error), 5000);
http.listen(Number(process.env.PORT ?? 4000), () =>
  console.log("MASARAK API ready; storage:", store.mode),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearInterval(timer);
    io.close();
    http.close(() => void store.close().then(() => process.exit(0)));
  });
