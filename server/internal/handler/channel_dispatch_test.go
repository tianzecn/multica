package handler

import "testing"

func TestInferChannelDispatchModeChinesePhrases(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		content string
		targets int
		want    string
	}{
		{
			name:    "single target",
			content: "哈雷看一下",
			targets: 1,
			want:    channelDispatchModeSingle,
		},
		{
			name:    "serial with rebuttal",
			content: "哈雷先说，最小变更工程师根据哈雷的发言反驳",
			targets: 2,
			want:    channelDispatchModeSerial,
		},
		{
			name:    "roundtable with final summary",
			content: "大家分别分析，最后技术负责人总结",
			targets: 3,
			want:    channelDispatchModeRoundtable,
		},
		{
			name:    "parallel with separate analysis",
			content: "你们分别分析这个方案",
			targets: 3,
			want:    channelDispatchModeParallel,
		},
		{
			name:    "fallback parallel",
			content: "这个方案怎么看",
			targets: 2,
			want:    channelDispatchModeParallel,
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, _ := inferChannelDispatchMode(tt.content, tt.targets)
			if got != tt.want {
				t.Fatalf("inferChannelDispatchMode() = %q, want %q", got, tt.want)
			}
		})
	}
}
