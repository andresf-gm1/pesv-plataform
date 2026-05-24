const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const prisma = new PrismaClient();
const dbFilePath = path.join(__dirname, "../data/db.json");

async function migrateDbJson() {
  try {
    const dbData = JSON.parse(fs.readFileSync(dbFilePath, "utf8"));

    console.log("Iniciando migración de db.json a PostgreSQL...");

    // 1. Migrar Companies
    for (const company of dbData.companies) {
      await prisma.company.upsert({
        where: { id: company.id },
        update: { ...company },
        create: { ...company },
      });
      console.log(`  - Empresa migrada: ${company.name}`);
    }

    // 2. Migrar Users
    for (const user of dbData.users) {
      // Asegurarse de que el companyId exista antes de crear el usuario
      const existingCompany = await prisma.company.findUnique({ where: { id: user.companyId } });
      if (!existingCompany) {
        console.warn(`    - Saltando usuario ${user.email}: companyId ${user.companyId} no encontrado.`);
        continue;
      }

      await prisma.user.upsert({
        where: { id: user.id }, // Usamos el ID para upsert, ya que el email es unique y podría cambiar
        update: {
          companyId: user.companyId,
          name: user.name,
          email: user.email,
          role: user.role,
          passwordHash: user.passwordHash, // Ya están hasheadas en db.json
          salt: user.salt,
          active: user.active,
          phone: user.phone,
          document: user.document,
          photoDataUrl: user.photoDataUrl,
          license: user.license,
          createdAt: user.createdAt,
        },
        create: {
          id: user.id,
          companyId: user.companyId,
          name: user.name,
          email: user.email,
          role: user.role,
          passwordHash: user.passwordHash,
          salt: user.salt,
          active: user.active,
          phone: user.phone,
          document: user.document,
          photoDataUrl: user.photoDataUrl,
          license: user.license,
          createdAt: user.createdAt,
        },
      });
      console.log(`  - Usuario migrado: ${user.name} (${user.email})`);
    }

    // 3. Migrar Vehicles
    for (const vehicle of dbData.vehicles) {
      const existingCompany = await prisma.company.findUnique({ where: { id: vehicle.companyId } });
      if (!existingCompany) {
        console.warn(`    - Saltando vehículo ${vehicle.plate}: companyId ${vehicle.companyId} no encontrado.`);
        continue;
      }
      await prisma.vehicle.upsert({
        where: { id: vehicle.id },
        update: { ...vehicle },
        create: { ...vehicle },
      });
      console.log(`  - Vehículo migrado: ${vehicle.plate}`);
    }

    // 4. Migrar Geofences
    for (const geofence of dbData.geofences) {
      await prisma.geofence.upsert({
        where: { id: geofence.id },
        update: { ...geofence },
        create: { ...geofence },
      });
      console.log(`  - Geocerca migrada: ${geofence.name}`);
    }

    // 5. Migrar DriverVehicleAssignments
    for (const assignment of dbData.driverVehicleAssignments) {
      await prisma.driverVehicleAssignment.upsert({
        where: { id: assignment.id },
        update: { ...assignment },
        create: { ...assignment },
      });
      console.log(`  - Asignación migrada: ${assignment.id}`);
    }

    console.log("Migración de db.json completada exitosamente.");
  } catch (error) {
    console.error("Error durante la migración:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

migrateDbJson();