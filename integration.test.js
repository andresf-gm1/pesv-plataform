const request = require('supertest');
const { app, prisma } = require('./server');
const { hashPassword } = require('./cryptoUtils');

describe('Pruebas de Integración: Login e Inicio de Viaje', () => {
    let token;
    let testUser;
    const testEmail = 'tester@fleetcommand.com';
    const testPass = 'Password123!';

    beforeAll(async () => {
        // Limpieza de datos previos de prueba
        await prisma.locationPing.deleteMany();
        await prisma.trip.deleteMany();
        await prisma.driverVehicleAssignment.deleteMany();
        await prisma.user.deleteMany({ where: { email: testEmail } });
        await prisma.vehicle.deleteMany({ where: { plate: 'TEST01' } });

        // 1. Crear Empresa de prueba
        const company = await prisma.company.upsert({
            where: { id: 'test-company-id' },
            update: {},
            create: { id: 'test-company-id', name: 'Test Corp', nit: '123-test' }
        });

        // 2. Crear Usuario conductor
        const pwd = hashPassword(testPass);
        testUser = await prisma.user.create({
            data: {
                id: 'test-driver-id',
                companyId: company.id,
                email: testEmail,
                name: 'Test Driver',
                passwordHash: pwd.hash,
                salt: pwd.salt,
                role: 'conductor',
                active: true
            }
        });

        // 3. Crear Vehículo y Asignación
        const vehicle = await prisma.vehicle.create({
            data: {
                id: 'test-veh-id',
                companyId: company.id,
                plate: 'TEST01',
                name: 'Vehículo de Prueba',
                type: 'Vehículo Liviano'
            }
        });

        await prisma.driverVehicleAssignment.create({
            data: {
                companyId: company.id,
                driverId: testUser.id,
                vehicleId: vehicle.id,
                active: true
            }
        });
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    test('Debe autenticar al usuario y devolver un token JWT', async () => {
        const response = await request(app)
            .post('/api/auth/login')
            .send({ email: testEmail, password: testPass });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.token).toBeDefined();
        token = response.body.token;
    });

    test('Debe iniciar un viaje correctamente usando el token obtenido', async () => {
        const response = await request(app)
            .post('/api/mobile/trips/start')
            .set('Authorization', `Bearer ${token}`)
            .send({ latitude: 4.6097, longitude: -74.0817, destination: 'Terminal Norte' });

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
        expect(response.body.trip.status).toBe('active');
        expect(response.body.trip.plate).toBe('TEST01');
    });
});
