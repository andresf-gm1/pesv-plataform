/**
 * Renderiza una gráfica de historial de salud del conductor.
 * @param {string} canvasId - El ID del elemento <canvas> en el HTML.
 * @param {string} driverId - ID del conductor a consultar.
 */
async function renderDriverHealthChart(canvasId, driverId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    try {
        const response = await fetch(`/api/reports/driver/${driverId}/health-history`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        const data = await response.json();

        if (!data || data.length === 0) {
            console.warn("No hay datos históricos para este conductor.");
            return;
        }

        const labels = data.map(item => new Date(item.date).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }));
        const scores = data.map(item => item.score);
        const pointColors = data.map(item => item.color);

        const ctx = canvas.getContext('2d');
        
        // Destruir instancia previa si existe para evitar duplicados al recargar
        if (window.healthChartInstance) {
            window.healthChartInstance.destroy();
        }

        window.healthChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Driver Health Score',
                    data: scores,
                    borderColor: '#3b82f6', // Azul primario
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true,
                    tension: 0.4, // Curva suave
                    pointBackgroundColor: pointColors,
                    pointBorderColor: '#fff',
                    pointRadius: 6,
                    pointHoverRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        title: { display: true, text: 'Puntaje de Aptitud (%)' }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const item = data[context.dataIndex];
                                return ` Salud: ${item.score}% - ${item.label}`;
                            }
                        }
                    }
                }
            }
        });
    } catch (error) {
        console.error("Error cargando el gráfico de salud:", error);
    }
}