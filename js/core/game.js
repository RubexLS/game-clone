import { BOARD_SQUARES } from './board.js';

export class GameManager {
    constructor() {
        this.propertiesState = {}; // Guarda el estado en la nube: { squareId: { ownerId, houses } }
    }

    /**
     * Valida si una propiedad puede ser comprada por un jugador
     * @param {Object} square - Datos de la casilla desde board.js
     * @param {Object} player - Instancia del jugador que cayó en ella
     * @returns {boolean} True si está libre y el jugador tiene dinero suficiente
     */
    canBuyProperty(square, player) {
        // Solo se compran tipos de casilla específicos
        const buyableTypes = ['property', 'railroad', 'utility'];
        if (!buyableTypes.includes(square.type)) return false;

        // Verificar si ya tiene dueño en el estado actual
        if (this.propertiesState[square.id]) return false;

        // Verificar fondos suficientes
        return player.money >= square.price;
    }

    /**
     * Calcula el alquiler básico que debe pagar un jugador al caer en propiedad ajena
     * @param {Object} square - Datos de la casilla
     * @returns {number} Monto a pagar (alquiler base)
     */
    calculateRent(square) {
        if (square.type === 'property' && square.rent) {
            return square.rent[0]; // Alquiler base sin casas por ahora
        }
        if (square.type === 'railroad') {
            return 25; // Alquiler base estándar de ferrocarril
        }
        if (square.type === 'utility') {
            return 25; // Alquiler base de servicios públicos
        }
        return 0;
    }

    calculatePropertyRepairCost(player, houseCost, hotelCost) {
        let totalCost = 0;

        for (const propertyId of player.properties || []) {
            const buildings = player.propertyBuildings?.[propertyId];

            if (!buildings) continue;

            const houses = buildings.houses || 0;
            const hotel = buildings.hotel ? 1 : 0;

            totalCost += houses * houseCost;
            totalCost += hotel * hotelCost;
        }
        return totalCost;
    }

    canBuildOnProperty(player, propertyId) {
        // Buscar la propiedad en el tablero
        const property = BOARD_SQUARES.find(
            square => square.id === propertyId
        );

        if (!property) {
            return {
                allowed: false,
                message: "La propiedad no existe."
            };
        }

        // Solo se puede construir en propiedades normales
        if (property.type !== 'property') {
            return {
                allowed: false,
                message: "No se puede construir en esta casilla."
            };
        }

        // El jugador debe ser dueño de la propiedad
        if (!(player.properties || []).includes(propertyId)) {
            return {
                allowed: false,
                message: "No eres dueño de esta propiedad."
            };
        }

        // Obtener todas las propiedades del mismo grupo
        const groupProperties = BOARD_SQUARES.filter(
            square =>
                square.type === 'property' &&
                square.group === property.group
        );

        // Verificar que el jugador tenga TODO el grupo
        const ownsEntireGroup = groupProperties.every(
            groupProperty => (player.properties || []).includes(groupProperty.id)
        );

        if (!ownsEntireGroup) {
            return {
                allowed: false,
                message: "Debes ser dueño de todas las propiedades de este grupo para construir."
            };
        }

        const buildings =
            player.propertyBuildings?.[propertyId] || {
                houses: 0,
                hotel: false
            };

        // Si ya tiene hotel, no puede seguir construyendo
        if (buildings.hotel) {
            return {
                allowed: false,
                message: "Esta propiedad ya tiene un hotel."
            };
        }

        // Máximo de 4 casas antes del hotel
        if ((buildings.houses || 0) >= 4) {
            return {
                allowed: false,
                message: "Esta propiedad tiene 4 casas. Puede convertirse en hotel."
            };
        }

        return {
            allowed: true,
            buildings
        };
    }

    buildHouse(player, propertyId, houseCost) {
        const validation = this.canBuildOnProperty(player, propertyId);

        if (!validation.allowed) {
            return { success: false, message: validation.message };
        }

        if (player.money < houseCost) {
            return { success: false, message: `${player.name} no tiene suficiente dinero para construir una casa.` }
        }

        if (!player.propertyBuildings) player.propertyBuildings = {};

        if (!player.propertyBuildings[propertyId]) {
            player.propertyBuildings[propertyId] = {
                houses: 0,
                hotel: false
            };
        }

        player.money -= houseCost;
        player.propertyBuildings[propertyId].houses += 1;

        const houses = player.propertyBuildings[propertyId].houses;

        return {
            success: true,
            message: `${player.name} construyó una casa. Ahora tiene ${houses} casa${houses === 1 ? '' : 's'} en esta propiedad.`,
            houses
        };
    }

    buildHotel(player, propertyId, hotelCost) {
        const buildings = player.propertyBuildings?.[propertyId];
        
        if (!buildings) {
            return { success: false, message: "Esta propiedad no tiene casas construidas." };
        }
    
        if (buildings.hotel) {
            return { success: false, message: "Esta propiedad ya tiene un hotel." };
        }
    
        if ((buildings.houses || 0) < 4) {
            return { success: false, message: "Necesitas 4 casas para construir un hotel." };
        }
    
        if (player.money < hotelCost) {
            return { success: false, message: `${player.name} no tiene suficiente dinero para construir un hotel.` };
        }
    
        player.money -= hotelCost;
    
        buildings.houses = 0;
        buildings.hotel = true;
    
        return {
            success: true,
            message: `${player.name} construyó un hotel en esta propiedad.`,
            hotel: true
        };
    }
}