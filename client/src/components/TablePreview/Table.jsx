import * as React from "react";
import { DataGrid } from "@mui/x-data-grid";
import Paper from "@mui/material/Paper";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { Plus, Trash2, Download } from "lucide-react";
import TextField from "@mui/material/TextField";

const paginationModel = { page: 0, pageSize: 5 };

export default function DataTable({
  translatedColumns,
  header,
  data,
  onDeleteRow,
  onEditRow,
}) {
  const [tableData, setTableData] = React.useState(data || []);
  const [isDarkMode, setIsDarkMode] = React.useState(false);

  // console.log("header: ", header);
  // console.log("translatedColumns: ", translatedColumns);
  // console.log("data: ", data);

  React.useEffect(() => {
    setTableData(data);
  }, [data]);

  const toCamelCase = (str) =>
    str
      .toLowerCase()
      .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) =>
        index === 0 ? word.toLowerCase() : word.toUpperCase()
      )
      .replace(/\s+/g, "");

  const formatBulletPoints = (content) => {
    if (!content || content === "Click to Edit") return content;
    
    // Check if content contains bullet points
    if (content.includes("•") && content.includes("\n")) {
      const points = content.split("\n").filter(point => point.trim() !== "");
      return (
        <ul className="list-disc pl-5 space-y-1">
          {points.map((point, index) => (
            <li key={index} className="text-sm">
              {point.replace(/^•\s*/, "").trim()}
            </li>
          ))}
        </ul>
      );
    }
    
    // Return plain text for non-bullet content
    return content;
  };

  const columns = [
    { field: "id", headerName: "ID", width: 70 },

    ...header.map((h, index) => {
      const field = toCamelCase(h); // internal field
      return {
        field,
        headerName: translatedColumns[index] || h, // ✅ use translated name
        width: 250,
        editable: true,
        renderCell: (params) => {
          const value = params.value || "";
          return (
            <div className="w-full">
              {formatBulletPoints(value)}
            </div>
          );
        },
        renderEditCell: (params) => {
          const originalColumn = header.find(
            (h) => toCamelCase(h) === params.field
          );
          const value = params.value === "Click to Edit" ? "" : params.value;

          return (
            <TextField
              multiline
              fullWidth
              minRows={3}
              value={value}
              onChange={(e) => {
                params.api.setEditCellValue({
                  id: params.id,
                  field: params.field,
                  value: e.target.value,
                });
                onEditRow(params.id, originalColumn, e.target.value);
              }}
              variant="standard"
              placeholder="Click to Edit"
            />
          );
        },
      };
    }),

    {
      field: "action",
      headerName: "Action",
      width: 70,
      sortable: false,
      renderCell: (params) => (
        <div className="flex justify-center w-full">
          <button
            onClick={() => onDeleteRow(params.id)}
            className="group/btn cursor-pointer inline-flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 text-red-500 dark:text-red-400 hover:text-white hover:bg-gradient-to-r hover:from-red-500 hover:to-red-600 dark:hover:from-red-600 dark:hover:to-red-700 rounded-lg sm:rounded-xl transition-all duration-300 hover:scale-110 hover:shadow-lg hover:shadow-red-500/25 border border-red-200 dark:border-red-700 hover:border-red-500 dark:hover:border-red-600"
            title="Delete row"
          >
            <Trash2 size={18} className="group-hover/btn:animate-pulse" />
          </button>
        </div>
      ),
    },
  ];

  const rows = tableData.map((item, index) => {
    const row = { id: index + 1 };
    header.forEach((h) => {
      const field = toCamelCase(h); // match column field
      row[field] = item[h] || "Click to Edit"; // use original data
    });
    return row;
  });

  React.useEffect(() => {
    const currentTheme = localStorage.getItem("theme");
    setIsDarkMode(currentTheme === "dark");

    // Listen for theme changes (when user toggles theme)
    const observer = new MutationObserver(() => {
      const newTheme = localStorage.getItem("theme");
      setIsDarkMode(newTheme === "dark");
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  const theme = React.useMemo(
    () =>
      createTheme({
        palette: {
          mode: isDarkMode ? "dark" : "light",
          primary: { main: "#2196f3" },
        },
      }),
    [isDarkMode]
  );

  return (
    <ThemeProvider theme={theme}>
      <Paper
        sx={{
          height: "auto",
          width: "100%",
          margin: "20px auto",
          border: `1px solid ${
            theme.palette.mode === "dark" ? "#0a0a0a" : "#f0ebeb"
          }`,
          boxShadow: "none",
          borderRadius: 2,
          pt: 2,
          backgroundColor: theme.palette.mode === "dark" ? "#0a0a0a" : "#fff",
          transition: "background-color 0.3s ease",
          overflowX: "auto", // ✅ Allow horizontal scrolling
        }}
        elevation={3}
      >
        <DataGrid
          autoHeight
          rows={rows}
          columns={columns}
          initialState={{ pagination: { paginationModel } }}
          pageSizeOptions={[5, 10]}
          columnHeaderHeight={56} // optional, default header height
          disableRowSelectionOnClick
          checkboxSelection
          getRowHeight={() => "auto"} // ✅ important: allow multiline
          sx={{
            border: 0,
            color: theme.palette.mode === "dark" ? "#e0e0e0" : "#000",

            "& .MuiDataGrid-cell": {
              borderBottom: `0px solid ${
                theme.palette.mode === "dark" ? "#333" : "#e0e0e0"
              }`,
              whiteSpace: "pre-wrap", // ✅ important
              wordBreak: "break-word",
              lineHeight: "1.5",
              alignItems: "flex-start",
              display: "flex",
              paddingTop: "8px",
              paddingBottom: "8px",
            },
            "& .MuiDataGrid-cellContent": {
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            },
            "& .MuiDataGrid-row": {
              maxHeight: "none !important",
              height: "auto !important",
            },

            "& .MuiDataGrid-columnHeaders": {
              backgroundColor:
                theme.palette.mode === "dark" ? "#1e1e1e" : "#e3f2fd",
              color: theme.palette.mode === "dark" ? "#90caf9" : "#0d47a1",
            },
            "& .MuiDataGrid-footerContainer": {
              backgroundColor:
                theme.palette.mode === "dark" ? "#303030" : "#e3f2fd",
            },
          }}
        />
      </Paper>
    </ThemeProvider>
  );
}
