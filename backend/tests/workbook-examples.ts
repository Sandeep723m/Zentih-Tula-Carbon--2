// Workbook TC-DOM-002a tab 07: worked examples, which the workbook says become the engine's tests.
// Each implemented formula adds its rows here; calculation.test.ts runs every row against the engine
// and compares within the row's own tolerance (tab 08 R-12). Inputs are as written in the workbook.
export interface WorkedExample {
  id: string // tab 07 Example ID
  formulaCode: string // tab 06 Calc ID
  activityCode: string // tab 02 activity the inputs describe
  proves: string
  input: { quantity: string; unit: string; gridLocation?: string; periodStart: string; parameters?: Record<string, unknown> }
  expected: number
  unit: 'tCO2e' | 'tCO2 (biogenic)' | 'tCO2'
  tolerance: number
  factorCode?: string // factor the workbook says is used
}

const FY2425 = '2024-04-01'
export const WORKED_EXAMPLES: WorkedExample[] = [
  {
    id: 'WE-01', formulaCode: 'C-01', activityCode: 'A-ST-DIESEL-GAS-OIL', proves: 'Stationary diesel in litres: volume to mass, NCV, three gases, CO2e (AR6)',
    input: { quantity: '10000', unit: 'l', periodStart: '2025-04-01', parameters: { density: '0.84', densityUnit: 'kg/l', ncv: '0.043' } },
    expected: 26.8564, unit: 'tCO2e', tolerance: 0.001,
  },
  {
    id: 'WE-02', formulaCode: 'C-01', activityCode: 'A-ST-NATURAL-GAS', proves: 'Natural gas by volume, default density',
    input: { quantity: '120000', unit: 'SCM', periodStart: FY2425, parameters: { density: '0.717', densityUnit: 'kg/m3' } },
    expected: 231.9243, unit: 'tCO2e', tolerance: 0.001,
  },
  {
    id: 'WE-03', formulaCode: 'C-01', activityCode: 'A-COAL', proves: 'Coal by mass, IPCC default NCV',
    input: { quantity: '1250', unit: 't', periodStart: FY2425 },
    expected: 3073.6669, unit: 'tCO2e', tolerance: 0.001, factorCode: 'EF-0001',
  },
  {
    id: 'WE-04', formulaCode: 'C-01', activityCode: 'A-ST-NATURAL-GAS', proves: 'Natural gas billed in kWh on a GCV basis is converted to NCV first (C-14), then C-01',
    input: { quantity: '500000', unit: 'kWh', periodStart: FY2425, parameters: { energyBasis: 'GCV' } },
    expected: 90.9745, unit: 'tCO2e', tolerance: 0.001,
  },
  {
    id: 'WE-05', formulaCode: 'C-02', activityCode: 'A-ST-WOOD-WOOD-WASTE', proves: 'Biomass: biogenic CO2 is a memo item, CH4 and N2O stay in Scope 1',
    input: { quantity: '200', unit: 't', periodStart: FY2425, parameters: { ncv: '0.0156' } },
    expected: 5.9342, unit: 'tCO2e', tolerance: 0.001,
  },
  {
    id: 'WE-06', formulaCode: 'C-02', activityCode: 'A-ST-WOOD-WOOD-WASTE', proves: 'Same example: the biogenic memo value',
    input: { quantity: '200', unit: 't', periodStart: FY2425, parameters: { ncv: '0.0156' } },
    expected: 349.44, unit: 'tCO2 (biogenic)', tolerance: 0.01,
  },
  {
    id: 'WE-07', formulaCode: 'C-03', activityCode: 'A-MO-DIESEL', proves: 'Road diesel, fuel-based, mobile CH4 and N2O',
    input: { quantity: '1000', unit: 'l', periodStart: FY2425, parameters: { density: '0.84', densityUnit: 'kg/l', ncv: '0.043' } },
    expected: 2.7191, unit: 'tCO2e', tolerance: 0.001,
  },
  {
    id: 'WE-08', formulaCode: 'C-03', activityCode: 'A-MO-PETROL-GASOL', proves: 'Petrol cars, distance-based: km to litres to emissions (C-15 feeds C-03)',
    input: { quantity: '12000', unit: 'km', periodStart: FY2425, parameters: { fuelEconomy: '12', density: '0.74', densityUnit: 'kg/l', ncv: '0.0443' } },
    expected: 2.3327, unit: 'tCO2e', tolerance: 0.001,
  },
  {
    id: 'WE-11', formulaCode: 'C-05', activityCode: 'A-FU-R-410A', proves: 'Refrigerant R-410A, mass balance, GWP AR6',
    input: { quantity: '12', unit: 'kg', periodStart: FY2425, parameters: { disposedKg: '0', recoveredKg: '0' } },
    expected: 27.066, unit: 'tCO2e', tolerance: 0.001, factorCode: 'EF-0289',
  },
  {
    id: 'WE-12', formulaCode: 'C-05', activityCode: 'A-FU-R-134A', proves: 'Refrigerant R-134a, screening method',
    input: { quantity: '50', unit: 'kg', periodStart: FY2425, parameters: { method: 'SCREENING', leakRate: '0.1' } },
    expected: 7.65, unit: 'tCO2e', tolerance: 0.001, factorCode: 'EF-0290',
  },
  {
    id: 'WE-13', formulaCode: 'C-05', activityCode: 'A-FU-SF6', proves: 'SF6 switchgear, disposed less recovered',
    input: { quantity: '0', unit: 'kg', periodStart: FY2425, parameters: { disposedKg: '20', recoveredKg: '18' } },
    expected: 50.4, unit: 'tCO2e', tolerance: 0.001, factorCode: 'EF-0300',
  },
  {
    id: 'WE-14', formulaCode: 'C-06', activityCode: 'A-GRID', proves: 'Electricity, location-based, FY2024-25 with CEA v21 factor',
    input: { quantity: '1200000', unit: 'kWh', gridLocation: 'India - National Average', periodStart: FY2425 },
    expected: 852.0, unit: 'tCO2e', tolerance: 0.01, factorCode: 'EF-0020',
  },
  {
    id: 'WE-15', formulaCode: 'C-07', activityCode: 'A-GRID', proves: 'Electricity, market-based, part covered by an I-REC',
    input: { quantity: '500', unit: 'MWh', gridLocation: 'India - National Average', periodStart: FY2425, parameters: { instrumentMWh: '300', instrumentType: 'I-REC', instrumentReference: 'IREC-TEST-1' } },
    expected: 142.0, unit: 'tCO2e', tolerance: 0.01, factorCode: 'EF-0020',
  },
  {
    id: 'WE-09', formulaCode: 'C-04', activityCode: 'A-PR-CEMENT-CLINK-PRODU', proves: 'Cement: clinker calcination at the IPCC default factor',
    input: { quantity: '100000', unit: 't', periodStart: FY2425, parameters: { abatedFraction: '0' } },
    expected: 52000.0, unit: 'tCO2', tolerance: 0.01, factorCode: 'EF-0308',
  },
  {
    id: 'WE-10', formulaCode: 'C-04', activityCode: 'A-PR-LIME-PRODU', proves: 'Lime production, high-calcium default',
    input: { quantity: '1000', unit: 't', periodStart: FY2425, parameters: { factorCode: 'EF-0309', abatedFraction: '0' } },
    expected: 750.0, unit: 'tCO2', tolerance: 0.01, factorCode: 'EF-0309',
  },
  {
    id: 'WE-16', formulaCode: 'C-21', activityCode: 'A-STEAM', proves: 'Purchased steam, supplier factor 60 kg CO2e per GJ',
    input: { quantity: '8000', unit: 'GJ', periodStart: FY2425, parameters: { supplierFactor: '60' } },
    expected: 480.0, unit: 'tCO2e', tolerance: 0.01,
  },
  {
    id: 'WE-17', formulaCode: 'C-08', activityCode: 'A-CO2-REC', proves: 'Recovered CO2 shown as a removal, not netted',
    input: { quantity: '500', unit: 't', periodStart: FY2425, parameters: { meterReference: 'Recovery plant meter M-1' } },
    expected: 500.0, unit: 'tCO2', tolerance: 0.01,
  },
  // WE-18 (C-09, AR6 and AR5) is tested on its own in calculation.test.ts. Not implemented: WE-19 to WE-21
  // (C-10 to C-12, product footprint and intensity, outside the Scope 1/2 totals).
]
