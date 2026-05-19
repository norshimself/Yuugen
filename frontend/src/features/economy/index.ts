// src/features/economy/index.ts

// Export Presentation Components
export { EconomyDeck } from "./components/EconomyDeck";

// Export Custom State Hooks
export { useEconomy } from "./hooks/useEconomy";

// Export Domain Services
export { economyService } from "./services/economyService";

// Export Type Contracts
export type { 
  UserProfile, 
  ShopItem, 
  EconomyStatusMessage, 
  DailyClaimResponse, 
  WorkResponse, 
  CrimeResponse, 
  GambleResponse, 
  BuyItemResponse 
} from "./types/economy.types";
