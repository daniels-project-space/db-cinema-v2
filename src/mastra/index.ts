import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core";
import { botModel } from "@/lib/ai";
import { RULES } from "./rules";
import {
  searchCatalog,
  getListing,
  checkAvailability,
  quotePrice,
  siteInfo,
  escalate,
} from "./tools";

const agentConfig: any = {
  name: "renterBot",
  instructions: RULES,
  model: botModel() as any,
  tools: {
    search_catalog: searchCatalog,
    get_listing: getListing,
    check_availability: checkAvailability,
    quote_price: quotePrice,
    site_info: siteInfo,
    escalate,
  },
};

export const renterBot = new Agent(agentConfig);

export const mastra = new Mastra({ agents: { renterBot } } as any);
