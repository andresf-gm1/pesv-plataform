const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('./cryptoUtils');

const prisma = new PrismaClient();

async function main() {
    console.log('--- Iniciando Seeding de la Base de Datos ---');

    const companyId = 'comp-real-001';
    const passwordData = hashPassword('Fleet2026!');

    // 1. Crear Empresa Principal
    const company = await prisma.company.upsert({
        where: { id: companyId },
        update: {},
        create: {
            id: companyId,
            name: 'Transportes Integrales S.A.S',
            nit: '900.123.456-7',
            city: 'Bogotá, Colombia',
            plan: 'Growth Fleet',
            billingStatus: 'active',
            brandPhrase: 'Seguridad en cada kilómetro',
            logoDataUrl: ''
        }
    });
    console.log('✅ Empresa creada:', company.name);

    // 2. Crear Usuarios de Gestión (Admin y Supervisor)
    const admin = await prisma.user.upsert({
        where: { email: 'gerencia@transportes.com' },
        update: {},
        create: {
            companyId,
            name: 'Andrés Gutiérrez',
            email: 'gerencia@transportes.com',
            role: 'admin',
            passwordHash: passwordData.hash,
            salt: passwordData.salt,
            active: true
        }
    });

    const supervisor = await prisma.user.upsert({
        where: { email: 'operaciones@transportes.com' },
        update: {},
        create: {
            companyId,
            name: 'Carlos Monitor',
            email: 'operaciones@transportes.com',
            role: 'supervisor',
            passwordHash: passwordData.hash,
            salt: passwordData.salt,
            active: true
        }
    });
    console.log('✅ Usuarios de gestión creados');

    // 3. Definición de Flota Realista (10 vehículos)
    const fleetData = [
        { plate: 'MKZ101', name: 'Ambulancia TAB 01', type: 'Ambulancia TAB', brand: 'Renault', model: '2023' },
        { plate: 'RTY202', name: 'Camioneta Escolta', type: 'Camioneta', brand: 'Toyota', model: '2022' },
        { plate: 'HJK303', name: 'Camión de Reparto', type: 'Transporte_Carga', brand: 'Hino', model: '2021' },
        { plate: 'NMO404', name: 'Moto Mensajería 1', type: 'Motocicleta', brand: 'Yamaha', model: '2024' },
        { plate: 'XCV505', name: 'Vehículo Administrativo', type: 'Vehiculo_Liviano', brand: 'Mazda', model: '2024' },
        { plate: 'BGT606', name: 'Ambulancia TAM 02', type: 'Ambulancia TAM', brand: 'Mercedes-Benz', model: '2023' },
        { plate: 'VFR707', name: 'Maquinaria Amarilla P1', type: 'Maquinaria_Amarilla', brand: 'Caterpillar', model: '2020' },
        { plate: 'NHY808', name: 'Cisterna Químicos', type: 'Sustancias_Peligrosas', brand: 'Kenworth', model: '2021' },
        { plate: 'MJU909', name: 'Moto Mensajería 2', type: 'Motocicleta', brand: 'Honda', model: '2023' },
        { plate: 'PLO010', name: 'Supervisor Campo 1', type: 'Vehiculo_Liviano', brand: 'Chevrolet', model: '2022' }
    ];

    console.log('🚀 Creando conductores, vehículos y asignaciones...');

    for (let i = 0; i < fleetData.length; i++) {
        const item = fleetData[i];
        const driverEmail = `conductor${i + 1}@transportes.com`;

        // Crear Conductor
        const driver = await prisma.user.upsert({
            where: { email: driverEmail },
            update: {},
            create: {
                companyId,
                name: `Conductor Profesional ${i + 1}`,
                email: driverEmail,
                role: 'conductor',
                passwordHash: passwordData.hash,
                salt: passwordData.salt,
                phone: `300123450${i}`,
                document: `10203040${i}`,
                driverStatus: 'Activo',
                active: true
            }
        });

        // Crear Vehículo
        const vehicle = await prisma.vehicle.upsert({
            where: { plate: item.plate },
            update: {},
            create: {
                companyId,
                plate: item.plate,
                name: item.name,
                type: item.type,
                brand: item.brand,
                model: item.model,
                odometer: 15000 + (i * 2500),
                status: 'Operativa'
            }
        });

        // Crear Asignación Activa
        await prisma.driverVehicleAssignment.create({
            data: {
                companyId,
                driverId: driver.id,
                vehicleId: vehicle.id,
                active: true,
                notes: 'Asignación de ruta fija mediante seeding'
            }
        });
    }

    // 4. Seeding de Configuración (Checklist y Telemetría)
    await prisma.telemetryConfig.upsert({
        where: { companyId },
        update: {},
        create: {
            companyId,
            data: {
                tracking: { minDistanceMeters: 15, maxIntervalMs: 30000 },
                analytics: { overspeedKmh: 80, harshBrakeDeltaKmh: 20 },
                maps: { style: 'dark', provider: 'openfreemap' }
            }
        }
    });

    // 5. Agregar algunas noticias normativas realistas
    await prisma.normativeNews.createMany({
        data: [
            {
                companyId,
                title: 'Actualización PESV 2024',
                source: 'Ministerio de Transporte',
                summary: 'Nuevos lineamientos para la auditoría anual de los 24 pasos.',
                priority: 'Alta',
                tags: ['Legal', 'Auditoría'],
                date: new Date()
            },
            {
                companyId,
                title: 'Campaña de Prevención de Fatiga',
                source: 'HSEQ Interno',
                summary: 'Recordatorio de pausas activas obligatorias cada 2 horas de conducción.',
                priority: 'Media',
                tags: ['Salud', 'Pausas Activas'],
                date: new Date()
            }
        ]
    });

    console.log('--- Seeding completado con éxito ---');
}

main()
    .catch((e) => {
        console.error('❌ Error en el seeding:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
