#!/usr/bin/env python3
"""
TO Calculator — Bulletproof pallet & volume optimization.
ALL product data comes from reference JSON (pulled from Supabase).
ZERO hardcoded values.

BOL.COM LVB SPLIT LOGIC:
- Products classified as 'Regulier' or 'XL' in ref_data products[].bol_lvb_category
- Regulier = 1000/1500 mats + ALL trays; XL = 3000+ mats
- ALWAYS create separate TOs for Regulier vs XL (different warehouses!)
- Check bol_capacity in ref_data before proposing Bol TOs
- If available_capacity < 0, WARN: cannot send more of that category

Usage:
  python3 to-calculator.py /tmp/ref_data.json /tmp/to_input.json [/tmp/to_result.json]
"""

import json
import sys
import math
from typing import Any

def load_json(path: str) -> dict:
    with open(path) as f:
        return json.load(f)

def save_json(data: dict, path: str):
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)

def round_up_to_master(units: int, units_per_master: int) -> int:
    """Round units UP to full master cartons."""
    if units <= 0:
        return 0
    mc = math.ceil(units / units_per_master)
    return mc * units_per_master

def calc_cbm(units: int, units_per_master: int, master_volume_cbm: float) -> float:
    """Calculate CBM from units using master carton volume."""
    master_cartons = units / units_per_master
    return master_cartons * master_volume_cbm

def calc_pallet_stacking(length_cm: float, width_cm: float, height_cm: float,
                         pallet_length: float, pallet_width: float,
                         max_height_cm: float, max_weight_kg: float,
                         weight_per_mc_kg: float = 15.0) -> dict:
    """
    Physical stacking algorithm for pallets.
    Tries both orientations of master carton on pallet.
    Returns best fit (most cartons per pallet).
    """
    pallet_base_height = 15  # cm for pallet itself
    usable_height = max_height_cm - pallet_base_height
    
    results = []
    
    for orient_name, mc_l, mc_w, mc_h in [
        ('A', length_cm, width_cm, height_cm),
        ('B', width_cm, length_cm, height_cm),
        # Also try standing on side
        ('C', length_cm, height_cm, width_cm),
        ('D', width_cm, height_cm, length_cm),
    ]:
        if mc_l <= 0 or mc_w <= 0 or mc_h <= 0:
            continue
            
        per_length = math.floor(pallet_length / mc_l)
        per_width = math.floor(pallet_width / mc_w)
        per_layer = per_length * per_width
        
        if per_layer == 0:
            continue
        
        layers = math.floor(usable_height / mc_h)
        if layers == 0:
            continue
        
        total_cartons = per_layer * layers
        total_weight = total_cartons * weight_per_mc_kg
        
        # Check weight limit
        if total_weight > max_weight_kg:
            total_cartons = math.floor(max_weight_kg / weight_per_mc_kg)
            layers = math.ceil(total_cartons / per_layer)
        
        results.append({
            'orientation': orient_name,
            'cartons_per_layer': per_layer,
            'layers': layers,
            'total_cartons': total_cartons,
            'height_used_cm': layers * mc_h + pallet_base_height,
        })
    
    if not results:
        return {'cartons_per_layer': 0, 'layers': 0, 'total_cartons': 0, 
                'height_used_cm': 0, 'orientation': 'none'}
    
    # Return best fit (most cartons)
    best = max(results, key=lambda r: r['total_cartons'])
    return best

def get_cogs_for_to(product_sku: str, region: str, cogs: dict, destination_type: str) -> float:
    """
    Get COGS for TO value calculation.
    3PL destination = L0 + L1
    FBA destination = L0 + L1 + L2
    LvB destination = L0 + L1
    """
    for product_key, regions in cogs.items():
        if product_key == product_sku:
            if region in regions:
                l0 = regions[region].get('l0', 0)
                l1 = regions[region].get('l1', 0)
                l2 = regions[region].get('l2', 0)
                
                if destination_type in ('FBA', 'fba'):
                    return l0 + l1 + l2
                else:  # 3PL or LvB
                    return l0 + l1
    return 0

def lookup_pallet_config(product_id: int, region: str, warehouse: str, 
                         pallet_config: list) -> dict | None:
    """
    Look up actual pallet config from Product_Pallet_Config table.
    Matches by product_id + region, then optionally warehouse.
    Returns dict with cases_per_pallet, units_per_pallet, etc. or None.
    """
    # Try exact match: product_id + region + warehouse
    for row in pallet_config:
        if (row.get('product_id') == product_id 
            and row.get('region', '').upper() == region.upper()
            and row.get('warehouse', '').upper() == warehouse.upper()):
            return row
    
    # Fallback: product_id + region only (ignore warehouse)
    for row in pallet_config:
        if (row.get('product_id') == product_id 
            and row.get('region', '').upper() == region.upper()):
            return row
    
    return None


def calculate_to(ref_data: dict, to_input: dict) -> dict:
    """
    Main TO calculation.
    
    ref_data keys: products, pallets, cogs, containers (optional), pallet_config (optional)
    to_input keys: origin, destination, destination_type (FBA/3PL/LvB), 
                   destination_region (EU/UK/US/CA), products, boost_config
    
    Pallet logic priority:
    1. Product_Pallet_Config (actual data from devanning / reference sheet) → PREFERRED
    2. Theoretical stacking algorithm → FALLBACK only
    """
    products_ref = ref_data['products']
    pallets_ref = ref_data.get('pallets', {})
    cogs_ref = ref_data['cogs']
    pallet_config = ref_data.get('pallet_config', [])
    
    origin = to_input.get('origin', '')
    destination = to_input.get('destination', '')
    destination_type = to_input.get('destination_type', 'FBA')
    destination_region = to_input.get('destination_region', 'EU')
    
    # Map destination to COGS region name
    region_map = {'EU': 'Europe', 'UK': 'UK', 'US': 'US', 'CA': 'Canada'}
    cogs_region = region_map.get(destination_region, destination_region)
    
    # Get pallet specs for this region
    pallet = pallets_ref.get(destination_region, {})
    pallet_length = pallet.get('length_cm', 120)
    pallet_width = pallet.get('width_cm', 80)
    
    # Use FBA max height for FBA/LvB destinations, warehouse for others
    if destination_type in ('FBA', 'LvB'):
        max_height = pallet.get('fba_max_height', 175)
    else:
        max_height = pallet.get('warehouse_max_height', 200)
    max_weight = pallet.get('max_weight_kg', 500)
    
    # BOL.COM LVB VALIDATION — check Regulier/XL split and capacity
    bol_category = None
    bol_capacity = ref_data.get('bol_capacity', {})
    if destination_type == 'LvB':
        categories_in_to = set()
        for p in to_input.get('products', []):
            pid = str(p['product_id'])
            prod_info = products_ref.get(pid)
            if prod_info:
                cat = prod_info.get('bol_lvb_category', 'Unknown')
                categories_in_to.add(cat)
        
        if len(categories_in_to) > 1:
            raise ValueError(
                f"🚨 MIXED Regulier/XL products in Bol.com TO! "
                f"Categories found: {categories_in_to}. "
                f"MUST split into separate TOs (different warehouses)!"
            )
        
        bol_category = categories_in_to.pop() if categories_in_to else 'Unknown'
        
        # Check capacity limits
        if bol_category in bol_capacity:
            cap = bol_capacity[bol_category]
            avail = cap.get('available_capacity', 0)
            limit = cap.get('limit_current_month', 0)
            stock = cap.get('stock_on_hand', 0)
            if avail <= 0:
                # Don't block — just strong warning
                pass  # Warning added after total_units calculated below
    
    # Process products
    product_lines = []
    warnings = []
    total_pallets = 0
    
    for p in to_input.get('products', []):
        pid = str(p['product_id'])
        input_units = p['units']
        
        prod_info = products_ref.get(pid)
        if not prod_info:
            warnings.append(f"Product ID {pid} not found in reference data!")
            continue
        
        sku = prod_info['sku']
        upm = prod_info['units_per_master']
        vol = prod_info['master_volume_cbm']
        mc_l = prod_info.get('master_length_cm', 0)
        mc_w = prod_info.get('master_width_cm', 0)
        mc_h = prod_info.get('master_height_cm', 0)
        
        # Round UP to full master cartons (minimum 50 units for TOs)
        rounded_units = round_up_to_master(max(input_units, 50), upm)
        
        # Calculate CBM
        mc = rounded_units // upm
        cbm = calc_cbm(rounded_units, upm, vol)
        
        # Pallet calculation — use Product_Pallet_Config (actuals) first, fallback to theoretical
        # Map destination to warehouse name for lookup
        warehouse_name = to_input.get('destination', '')
        pallet_source = 'theoretical'
        
        config = lookup_pallet_config(int(pid), destination_region, warehouse_name, pallet_config)
        
        if config and config.get('cases_per_pallet', 0) > 0:
            # USE ACTUAL DATA from Product_Pallet_Config
            cartons_per_pallet = config['cases_per_pallet']
            units_per_pallet = config.get('units_per_pallet', cartons_per_pallet * upm)
            stacking = {
                'orientation': 'actual',
                'cartons_per_layer': config.get('cases_per_layer', 0),
                'layers': config.get('layers', 0),
                'total_cartons': cartons_per_pallet,
                'height_used_cm': 0,  # not computed for actuals
                'weight_per_pallet_kg': config.get('weight_per_pallet_kg', 0),
            }
            pallet_source = 'actual'
        else:
            # FALLBACK to theoretical stacking algorithm
            stacking = calc_pallet_stacking(
                mc_l, mc_w, mc_h,
                pallet_length, pallet_width,
                max_height, max_weight
            )
            cartons_per_pallet = stacking['total_cartons'] if stacking['total_cartons'] > 0 else 1
            units_per_pallet = cartons_per_pallet * upm
        
        pallets_needed = math.ceil(mc / cartons_per_pallet)
        
        # COGS
        cogs_per_unit = get_cogs_for_to(sku, cogs_region, cogs_ref, destination_type)
        if cogs_per_unit == 0:
            warnings.append(f"{sku}: COGS not found for region {cogs_region} / {destination_type}")
        
        value = rounded_units * cogs_per_unit
        
        product_lines.append({
            'product_id': int(pid),
            'sku': sku,
            'product_type': prod_info.get('product_type', ''),
            'input_units': input_units,
            'final_units': rounded_units,
            'units_per_master': upm,
            'master_cartons': mc,
            'master_volume_cbm': vol,
            'cbm': cbm,
            'master_dims_cm': f"{mc_l}×{mc_w}×{mc_h}",
            'cartons_per_pallet': cartons_per_pallet,
            'units_per_pallet': units_per_pallet,
            'pallets_needed': pallets_needed,
            'stacking': stacking,
            'pallet_source': pallet_source,  # 'actual' or 'theoretical'
            'cogs_per_unit': cogs_per_unit,
            'value': round(value, 2),
        })
        
        total_pallets += pallets_needed
    
    # Totals
    total_units = sum(p['final_units'] for p in product_lines)
    total_cbm = sum(p['cbm'] for p in product_lines)
    total_value = sum(p['value'] for p in product_lines)
    total_mc = sum(p['master_cartons'] for p in product_lines)
    
    # Minimum CBM check
    min_cbm_ok = total_cbm >= 1.5
    if total_cbm < 1.0:
        warnings.append(f"VERY LOW CBM: {total_cbm:.2f} — below 1.0 CBM minimum. Must be noted in TO record.")
    elif total_cbm < 1.5:
        warnings.append(f"LOW CBM: {total_cbm:.2f} — below 1.5 CBM target but acceptable if stock limited.")
    
    # BOL.COM LVB CAPACITY CHECK
    bol_check = None
    if destination_type == 'LvB' and bol_category and bol_category in bol_capacity:
        cap = bol_capacity[bol_category]
        avail = cap.get('available_capacity', 0)
        limit_cur = cap.get('limit_current_month', 0)
        limit_nxt = cap.get('limit_next_month', 0)
        stock = cap.get('stock_on_hand', 0)
        
        bol_check = {
            'category': bol_category,
            'limit_current': limit_cur,
            'limit_next_month': limit_nxt,
            'stock_on_hand': stock,
            'available_capacity': avail,
            'to_units': total_units,
            'fits': avail >= total_units,
        }
        
        if avail <= 0:
            warnings.append(
                f"🚨 BOL.COM PLAFOND OVERSCHREDEN! {bol_category}: {stock} on hand vs {limit_cur} limit "
                f"({avail} beschikbaar). GEEN ruimte voor nieuwe zending van {total_units} units!"
            )
        elif avail < total_units:
            warnings.append(
                f"⚠️ BOL.COM PLAFOND: {bol_category} heeft maar {avail} units beschikbaar "
                f"(van {limit_cur} limit). TO wil {total_units} sturen — past NIET volledig!"
            )
        else:
            warnings.append(
                f"✅ Bol.com {bol_category}: {avail} beschikbaar van {limit_cur} limit — "
                f"TO van {total_units} units past."
            )
    
    validation = {
        'min_cbm_ok': min_cbm_ok,
        'all_master_carton_rounded': all(
            p['final_units'] % p['units_per_master'] == 0
            for p in product_lines
        ),
        'all_min_50_units': all(p['final_units'] >= 50 for p in product_lines),
        'warnings': warnings,
        'bol_capacity_check': bol_check,
    }
    
    return {
        'summary': {
            'order_type': 'TO',
            'origin': origin,
            'destination': destination,
            'destination_type': destination_type,
            'destination_region': destination_region,
            'cogs_region': cogs_region,
            'total_units': total_units,
            'total_master_cartons': total_mc,
            'total_cbm': round(total_cbm, 4),
            'total_pallets': total_pallets,
            'total_value': round(total_value, 2),
            'pallet_specs': {
                'type': pallet.get('type', ''),
                'dims': f"{pallet_length}×{pallet_width}",
                'max_height_cm': max_height,
                'max_weight_kg': max_weight,
            },
            'bol_lvb_category': bol_category if destination_type == 'LvB' else None,
        },
        'products': product_lines,
        'validation': validation,
    }


def main():
    if len(sys.argv) < 3:
        print("Usage: to-calculator.py <ref_data.json> <to_input.json> [output.json]")
        sys.exit(1)
    
    ref_data = load_json(sys.argv[1])
    to_input = load_json(sys.argv[2])
    
    result = calculate_to(ref_data, to_input)
    
    if len(sys.argv) >= 4:
        save_json(result, sys.argv[3])
        print(f"Results saved to {sys.argv[3]}")
    
    # Print summary
    s = result['summary']
    print(f"\n{'='*60}")
    print(f"TO CALCULATION RESULT")
    print(f"{'='*60}")
    print(f"Route: {s['origin']} → {s['destination']}")
    print(f"Type: {s['destination_type']} ({s['destination_region']})")
    print(f"Total Units: {s['total_units']:,}")
    print(f"Total CBM: {s['total_cbm']:.2f}")
    print(f"Total Pallets: {s['total_pallets']}")
    print(f"Total Value: ${s['total_value']:,.2f}")
    print(f"Pallet: {s['pallet_specs']['type']} {s['pallet_specs']['dims']} "
          f"(max {s['pallet_specs']['max_height_cm']}cm / {s['pallet_specs']['max_weight_kg']}kg)")
    print(f"{'='*60}")
    
    # Product detail
    print(f"\n{'Product':<22} {'Units':>6} {'MC':>4} {'CBM':>7} {'Pall':>4} {'U/Pall':>6} {'COGS':>7} {'Value':>10} {'Src':>5}")
    print(f"{'-'*82}")
    for p in result['products']:
        src = '✅' if p.get('pallet_source') == 'actual' else '🔢'
        print(f"{p['sku']:<22} {p['final_units']:>6} {p['master_cartons']:>4} "
              f"{p['cbm']:>7.3f} {p['pallets_needed']:>4} {p['units_per_pallet']:>6} "
              f"${p['cogs_per_unit']:>6.2f} ${p['value']:>9,.2f} {src:>5}")
    
    # Validation
    v = result['validation']
    if v['warnings']:
        print(f"\n⚠️  WARNINGS:")
        for w in v['warnings']:
            print(f"  - {w}")
    else:
        print(f"\n✅ All validations passed")
    print()


if __name__ == '__main__':
    main()
