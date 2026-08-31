import { openDatabase } from "../server/database.js";
import { createCatalogService } from "../server/modules/catalog/service.js";

const db = await openDatabase();
await db.verifyRuntimeSecurity({ enforce: true });

const catalog = createCatalogService({
  db,
  currentUserId() {
    throw new Error("The operator catalog import must not access user-scoped data.");
  }
});

for (const subject of ["math", "english"]) {
  const result = await catalog.importQuestions("collegeboard", subject, "main");
  console.log(
    `Imported ${result.imported} ${subject} questions (${result.excludedBluebook} Bluebook-excluded).`
  );
}

console.log("College Board question catalog is current.");
