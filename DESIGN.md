# Thogai design

The attached HTML prototype sets the visual direction. Thogai uses a violet accent, a light lavender navigation rail, white panels and a cool neutral canvas. Teal marks collections and active states.

The standalone company picker presents each company as a card and places company creation alongside them. Inside a company, the header shows the current company and the sidebar separates work from management. Dashboards label their sample totals, and bill creation and customer creation remain easy to find. Forms keep optional fields expandable, and draft print views use white paper.

## Controls

Buttons use one 44px minimum height, 8px radius, shared icon size, and primary or outlined variants. Dropdowns use the shared Radix-based Dropdown component; customer search uses the same trigger, menu, selection, and focus treatments. Checkboxes use the shared violet checked state and focus ring. Inputs and dropdowns share border, radius, type scale, disabled treatment, and keyboard focus color.

## Analytics surfaces
The central dashboard and Reports overview follow the supplied November 13 dashboard reference: light navigation, violet emphasis, compact six-card totals, paired trend charts, entity and status donuts, customer rankings, aging and printing mix, and recent-document tables. Analytics use saved browser records only. Central filters can narrow to one active company; company reports remain scoped to their company. Date filters drive the overview, while search filters recent bills and challans. Detailed reports retain their date controls and printable tables. Mobile stacks the panels and contains table scrolling inside each panel. Do not display invented growth comparisons or delivery statuses.

All workspace pages share the central dashboard palette: violet #7c3bd1, light lavender navigation #fcfaff, white panels and #f7f7fc canvas. Company dashboards name and isolate the selected company; the central dashboard compares active companies with a table and grouped charts. Green, amber and red communicate payment states. Saved custom document accents remain editable.

Central dashboard preview: Show mock data starts off (zero values and empty record panels). Turning it on uses dashboard-mock-data.ts fixtures for all analytics and filters, without writing browser records. Company dashboards continue to use saved records. Sample document numbers are text rather than links to nonexistent saved documents.
