import { Router } from "express";
import multer from "multer";
import * as modificationRoutes from "./modification";
import * as xmlModificationRoutes from "./xml_modification";
import * as toolRoutes from "./utility";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024,
    fieldSize: 500 * 1024 * 1024,
  },
});

export const createRoutes = () => {
  const router = Router();

  // Modification endpoint requires image + instruction + base JSON.
  router.post(
    "/modification",
    upload.single("image"),
    modificationRoutes.runModification
  );

  // XML ablation endpoint (same as modification but with ID remapping)
  router.post(
    "/xml-modification",
    upload.single("image"),
    xmlModificationRoutes.runXmlModification
  );

  // Utility / tool proxy endpoints
  router.post(
    "/tool/delete_all_top_level_nodes",
    toolRoutes.deleteAllTopLevelNodes
  );
  router.post("/tool/get_channels", toolRoutes.getChannels);
  router.post("/tool/select_channel", toolRoutes.selectChannel);
  router.post("/tool/export_json", toolRoutes.exportJson);
  router.post("/tool/import_json", toolRoutes.importJson);

  return router;
};
