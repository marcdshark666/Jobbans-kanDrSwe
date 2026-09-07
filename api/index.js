// Vercel-ingång: samma Express-app som server.js, men utan app.listen().
// vercel.json skickar /api/* och /unsubscribe hit; statiska filer serveras
// direkt från dist/ av Vercels CDN.
import app from "../server.js";

export default app;
