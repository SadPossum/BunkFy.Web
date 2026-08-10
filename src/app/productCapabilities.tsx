import { createContext, useContext, type ReactNode } from "react";
import { apiRequest } from "../api/client";

export type ProductCapabilities = {
  emailVerificationEnabled: boolean;
};

const unavailableCapabilities: ProductCapabilities = {
  emailVerificationEnabled: false,
};

const ProductCapabilitiesContext = createContext<ProductCapabilities>(
  unavailableCapabilities,
);

export function ProductCapabilitiesProvider({
  capabilities,
  children,
}: {
  capabilities: ProductCapabilities;
  children: ReactNode;
}) {
  return (
    <ProductCapabilitiesContext.Provider value={capabilities}>
      {children}
    </ProductCapabilitiesContext.Provider>
  );
}

export function useProductCapabilities(): ProductCapabilities {
  return useContext(ProductCapabilitiesContext);
}

export async function loadProductCapabilities(): Promise<ProductCapabilities> {
  try {
    const capabilities = await apiRequest<Partial<ProductCapabilities>>(
      "/api/product-capabilities",
      {
        signal: AbortSignal.timeout(5_000),
      },
    );
    return {
      emailVerificationEnabled: capabilities.emailVerificationEnabled === true,
    };
  } catch {
    return unavailableCapabilities;
  }
}
