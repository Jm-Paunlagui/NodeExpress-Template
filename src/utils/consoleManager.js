const { logger } = require("./logger");

class ConsoleManager {
    constructor() {
        this.lastClearDate = new Date().toDateString();
        this.isInitialized = false;
        this.clearIntervalId = null;
    }

    /**
     * Initialize the console manager
     */
    initialize() {
        if (this.isInitialized) return;

        // Set process title for compiled PKG applications
        this.setProcessTitle();

        // Display ASCII art on startup
        this.displayAsciiArt();

        // Setup daily console clearing
        this.setupDailyConsoleClear();

        // Setup graceful shutdown cleanup
        this.setupShutdownHandlers();

        this.isInitialized = true;
        logger.notice("Console Manager initialized successfully");
    }

    /**
     * Set the process title for PKG compiled applications
     */
    setProcessTitle() {
        try {
            const title = process.env.APP_NAME || "MEAL Backend Server";
            process.title = title;

            // Verify the title was set
            if (process.title === title) {
                logger.notice(`Process title set to: ${title}`);
            } else {
                logger.warning(
                    `Failed to set process title. Current: ${process.title}`,
                );
            }
        } catch (error) {
            logger.warning("Error setting process title:", {
                error: error.message,
            });
        }
    }

    /**
     * Display the ASCII art banner
     */
    displayAsciiArt() {
        const border = "=".repeat(172);
        const asciiArt = `
            .oooooo.         .o.       ooooooooooooo ooooo   ooooo oooooooooooo ooooooooo.   ooooo ooooo      ooo oooooooooooo      oooooooooo.  oooooooooooo 
           d8P'  \`Y8b       .888.      8'   888   \`8 \`888'   \`888' \`888'     \`8 \`888   \`Y88. \`888' \`888b.     \`8' \`888'     \`8      \`888'   \`Y8b \`888'     \`8 
          888              .8"888.          888       888     888   888          888   .d88'  888   8 \`88b.    8   888               888     888  888         
          888             .8' \`888.         888       888ooooo888   888oooo8     888ooo88P'   888   8   \`88b.  8   888oooo8          888oooo888'  888oooo8    
          888            .88ooo8888.        888       888     888   888    "     888\`88b.     888   8     \`88b.8   888    "          888    \`88b  888    "    
          \`88b    ooo   .8'     \`888.       888       888     888   888       o  888  \`88b.   888   8       \`888   888       o       888    .88P  888       o 
           \`Y8bood8P'  o88o     o8888o     o888o     o888o   o888o o888ooooood8 o888o  o888o o888o o8o        \`8  o888ooooood8      o888bood8P'  o888ooooood8                                                                                                                                                                                                                                                  
        `;

        console.log("\n" + border);
        console.log(asciiArt);
        console.log(border);
        console.log(
            `                                                                        CATHERINE Backend Server`,
        );
        console.log(
            `                                        Class-based Architecture, Tailwind, Hardened Express, React Integrated Node Ecosystem`,
        );
        console.log(
            `                                                                      Author: John Moises Paunlagui`,
        );
        console.log(border + "\n");
    }

    /**
     * Setup daily console clearing to prevent performance issues
     */
    setupDailyConsoleClear() {
        // Clear console immediately if it's a new day
        this.checkAndClearConsole();

        // Set up interval to check every hour
        this.clearIntervalId = setInterval(
            () => {
                this.checkAndClearConsole();
            },
            60 * 60 * 1000,
        ); // Check every hour

        logger.notice("Daily console clearing scheduled");
    }

    /**
     * Check if it's a new day and clear console if needed
     */
    checkAndClearConsole() {
        const currentDate = new Date().toDateString();

        if (currentDate !== this.lastClearDate) {
            this.clearConsole();
            this.lastClearDate = currentDate;

            // Show ASCII art after clearing console
            this.displayAsciiArt();

            logger.info("Console cleared for new day", {
                date: currentDate,
                reason: "Daily reset to prevent performance issues",
            });
        }
    }

    /**
     * Clear the console
     */
    clearConsole() {
        try {
            // Clear console for different platforms
            if (process.platform === "win32") {
                // Windows
                process.stdout.write("\x1B[2J\x1B[0f");
            } else {
                // Unix/Linux/Mac
                process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
            }

            // Alternative method for better compatibility
            console.clear();
        } catch (error) {
            logger.warning("Error clearing console:", { error: error.message });
        }
    }

    /**
     * Manual console clear (can be called externally)
     */
    manualClear() {
        this.clearConsole();
        this.displayAsciiArt();
        logger.info("Console manually cleared");
    }

    /**
     * Setup graceful shutdown handlers
     */
    setupShutdownHandlers() {
        const cleanup = () => {
            if (this.clearIntervalId) {
                clearInterval(this.clearIntervalId);
                this.clearIntervalId = null;
            }
        };

        process.on("SIGTERM", cleanup);
        process.on("SIGINT", cleanup);
        process.on("exit", cleanup);
    }

    /**
     * Get console manager status
     */
    getStatus() {
        return {
            initialized: this.isInitialized,
            lastClearDate: this.lastClearDate,
            processTitle: process.title,
            intervalActive: !!this.clearIntervalId,
            nextClearCheck: this.getNextClearTime(),
        };
    }

    /**
     * Get next clear time estimate
     */
    getNextClearTime() {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        return tomorrow.toISOString();
    }

    /**
     * Force reset console (useful for testing or manual triggers)
     */
    forceReset() {
        this.clearConsole();
        this.displayAsciiArt();
        this.lastClearDate = new Date().toDateString();
        logger.info("Console force reset completed");
    }
}

// Create singleton instance
const consoleManager = new ConsoleManager();

module.exports = {
    consoleManager,
    ConsoleManager,
};
