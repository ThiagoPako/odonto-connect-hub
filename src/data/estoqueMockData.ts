export interface InventoryItem {
  id: string;
  name: string;
  category: "material" | "medicamento" | "protese" | "descartavel" | "instrumental";
  unit: string;
  currentStock: number;
  minStock: number;
  maxStock: number;
  unitCost: number;
  supplier: string;
  lastEntry: string;
  expirationDate?: string;
}

export interface StockMovement {
  id: string;
  itemId: string;
  itemName: string;
  type: "entrada" | "saida" | "ajuste";
  quantity: number;
  date: string;
  reason: string;
  user: string;
}

export const inventoryCategories = [
  { id: "material" as const, label: "Materiais" },
  { id: "medicamento" as const, label: "Medicamentos" },
  { id: "protese" as const, label: "Próteses" },
  { id: "descartavel" as const, label: "Descartáveis" },
  { id: "instrumental" as const, label: "Instrumental" },
];

export const mockInventory: InventoryItem[] = [
  { id: "i1", name: "Resina Composta A2", category: "material", unit: "seringa", currentStock: 8, minStock: 5, maxStock: 30, unitCost: 85, supplier: "Dentsply", lastEntry: "01/04/2026" },
  { id: "i2", name: "Anestésico Articaína 4%", category: "medicamento", unit: "caixa (50un)", currentStock: 3, minStock: 5, maxStock: 20, unitCost: 220, supplier: "DFL", lastEntry: "25/03/2026", expirationDate: "10/2027" },
  { id: "i3", name: "Implante Straumann BLT 4.1x10mm", category: "protese", unit: "unidade", currentStock: 12, minStock: 5, maxStock: 25, unitCost: 1200, supplier: "Straumann", lastEntry: "15/03/2026" },
  { id: "i4", name: "Luvas Procedimento M", category: "descartavel", unit: "caixa (100un)", currentStock: 2, minStock: 10, maxStock: 50, unitCost: 35, supplier: "Supermax", lastEntry: "20/03/2026" },
  { id: "i5", name: "Sugador descartável", category: "descartavel", unit: "pct (100un)", currentStock: 15, minStock: 5, maxStock: 30, unitCost: 18, supplier: "SSPlus", lastEntry: "28/03/2026" },
  { id: "i6", name: "Fio Ortodôntico NiTi 0.014", category: "material", unit: "rolo", currentStock: 20, minStock: 10, maxStock: 50, unitCost: 42, supplier: "Morelli", lastEntry: "01/04/2026" },
  { id: "i7", name: "Cimento Resinoso Dual", category: "material", unit: "kit", currentStock: 4, minStock: 3, maxStock: 15, unitCost: 320, supplier: "3M", lastEntry: "10/03/2026" },
  { id: "i8", name: "Amoxicilina 500mg", category: "medicamento", unit: "caixa (21cp)", currentStock: 18, minStock: 10, maxStock: 40, unitCost: 25, supplier: "Medley", lastEntry: "05/04/2026", expirationDate: "03/2028" },
  { id: "i9", name: "Coroa de Porcelana E-max", category: "protese", unit: "unidade", currentStock: 0, minStock: 3, maxStock: 10, unitCost: 850, supplier: "Ivoclar", lastEntry: "20/02/2026" },
  { id: "i10", name: "Broca Carbide FG 1/4", category: "instrumental", unit: "unidade", currentStock: 25, minStock: 10, maxStock: 50, unitCost: 12, supplier: "KG Sorensen", lastEntry: "01/04/2026" },
];

export const mockMovements: StockMovement[] = [
  { id: "m1", itemId: "i1", itemName: "Resina Composta A2", type: "entrada", quantity: 10, date: "01/04/2026", reason: "Compra fornecedor", user: "Admin" },
  { id: "m2", itemId: "i4", itemName: "Luvas Procedimento M", type: "saida", quantity: 8, date: "07/04/2026", reason: "Consumo semanal", user: "Recepção" },
  { id: "m3", itemId: "i3", itemName: "Implante Straumann BLT 4.1x10mm", type: "saida", quantity: 1, date: "01/04/2026", reason: "Cirurgia — Maria Silva", user: "Dr. Ricardo" },
  { id: "m4", itemId: "i2", itemName: "Anestésico Articaína 4%", type: "entrada", quantity: 5, date: "25/03/2026", reason: "Compra fornecedor", user: "Admin" },
  { id: "m5", itemId: "i9", itemName: "Coroa de Porcelana E-max", type: "saida", quantity: 2, date: "05/04/2026", reason: "Prótese — Lucia Ferreira", user: "Dra. Beatriz" },
  { id: "m6", itemId: "i8", itemName: "Amoxicilina 500mg", type: "entrada", quantity: 10, date: "05/04/2026", reason: "Reposição", user: "Admin" },
];
