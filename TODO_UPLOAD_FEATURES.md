# Upload Features TODO

## Monthly Checkouts Target Line

### Current Status
- The **Monthly Checkouts** chart in the Provider Dashboard now displays a horizontal gray dashed target line
- The target line value is currently **hardcoded as `100`** in [src/pages/ProviderDashboard.tsx](src/pages/ProviderDashboard.tsx#L293)

### Implementation Details
- **Location**: `refMonthlyChk` chart series config (line 293)
- **Variable**: `targetLine = 100`
- **Appearance**: Gray dashed line with "Target 100" label
- **Chart Type**: Vertical column (bar) chart

### To Complete
1. **Add API endpoint** to retrieve the target checkout value from upload/settings
2. **Update the chart initialization** to fetch `targetLine` value dynamically instead of hardcoded value
3. **Wire the upload flow** to store and persist the target line configuration
4. **Update chart refresh** to pull latest target value when summary data updates

### Example Implementation
```typescript
// TODO: Replace hardcoded value with API call
const targetLine = await getUploadSettings().then(s => s.checkoutTarget) || 100;
```

### Related
- No-show Rate chart already uses this pattern with average line (see `refNoShowRate.current`)
- Both charts use the same `markLine` ECharts feature for horizontal reference lines
